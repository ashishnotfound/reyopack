// supabase/functions/get-shipping-label/index.ts
// Fetches Easy Ship label PDF from Amazon and stores in Supabase Storage
// Returns a signed URL for the frontend to display

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { spApiFetch } from "../_shared/amazon-auth.ts";

interface GetLabelRequest {
  amazon_order_id: string;
  package_id?: string;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Verify user
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: "Invalid token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const db = createClient(supabaseUrl, serviceKey);

  let body: GetLabelRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!body.amazon_order_id) {
    return new Response(
      JSON.stringify({ error: "amazon_order_id is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { amazon_order_id } = body;

  try {
    const { data: order } = await db
      .from("orders")
      .select("id")
      .eq("amazon_order_id", amazon_order_id)
      .maybeSingle();
    if (!order) {
      return new Response(JSON.stringify({ error: `Order not found: ${amazon_order_id}`, code: "ORDER_NOT_FOUND" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if we already have a stored label URL
    const { data: shipment } = await db
      .from("shipments")
      .select("label_url, awb_number, amazon_shipment_id")
      .eq("order_id", order.id)
      .maybeSingle();

    if (shipment?.label_url) {
      // Return existing signed URL (or extend if close to expiry)
      const storagePath = shipment.label_url.includes("/storage/v1/")
        ? extractStoragePath(shipment.label_url)
        : null;

      if (storagePath) {
        const { data: signedData } = await db.storage
          .from("shipping-labels")
          .createSignedUrl(storagePath, 3600); // 1-hour signed URL

        return new Response(
          JSON.stringify({ label_url: signedData?.signedUrl, awb: shipment.awb_number }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ label_url: shipment.label_url, awb: shipment.awb_number }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch label from Amazon Easy Ship v2022-03-23
    const labelReq = {
      amazonOrderId: amazon_order_id,
      packageId: body.package_id,
    };

    // Get label as PDF bytes
    const labelRes = await spApiFetch(
      `/easyShip/2022-03-23/label`,
      {
        method: "POST",
        body: JSON.stringify(labelReq),
        headers: { "Content-Type": "application/json" },
      }
    );

    if (!labelRes.ok) {
      // Fallback: try to get from packages endpoint
      const pkgRes = await spApiFetch(
        `/easyShip/2022-03-23/packages?amazonOrderId=${amazon_order_id}`
      );

      if (pkgRes.ok) {
        const pkgData = await pkgRes.json();
        const labelUrl = pkgData.packages?.[0]?.labelDetails?.labelUri;
        
        if (labelUrl) {
          return new Response(
            JSON.stringify({ label_url: labelUrl }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      return new Response(
        JSON.stringify({ error: "Label not yet available from Amazon", code: "LABEL_NOT_AVAILABLE" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upload to Supabase Storage
    const labelBytes = await labelRes.arrayBuffer();
    const storageKey = `labels/${amazon_order_id}.pdf`;

    const { error: uploadError } = await db.storage
      .from("shipping-labels")
      .upload(storageKey, labelBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    // Create 24-hour signed URL
    const { data: signedUrl } = await db.storage
      .from("shipping-labels")
      .createSignedUrl(storageKey, 86400);

    // Update shipment record
    if (shipment) {
      await db.from("shipments").update({
        label_url: storageKey,
        label_format: "PDF",
        updated_at: new Date().toISOString(),
      }).eq("order_id", order.id);
    }

    return new Response(
      JSON.stringify({ label_url: signedUrl?.signedUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function extractStoragePath(url: string): string | null {
  const match = url.match(/\/storage\/v1\/object\/sign\/shipping-labels\/(.+)$/);
  return match ? match[1].split("?")[0] : null;
}
