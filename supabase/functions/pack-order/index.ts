// supabase/functions/pack-order/index.ts
// Atomic order packing Edge Function
// Calls the PostgreSQL atomic_pack_order function via service role
// Prevents duplicate packing via SELECT FOR UPDATE at database level

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

interface PackOrderRequest {
  amazon_order_id: string;
  session_id?: string;
  awb_scanned?: string;
  device_info?: string;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Require authentication
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

  // Verify calling user's JWT
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

  // Service-role client for DB writes
  const db = createClient(supabaseUrl, serviceKey);

  // Verify user is active packer or admin
  const { data: profile } = await db
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active || !["PACKER", "ADMIN"].includes(profile.role)) {
    return new Response(
      JSON.stringify({ error: "Forbidden: Packer or Admin role required" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Parse request body
  let body: PackOrderRequest;
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

  // Call the atomic PostgreSQL function
  const { data: result, error: fnError } = await db.rpc("atomic_pack_order", {
    p_amazon_order_id: body.amazon_order_id,
    p_packer_id: user.id,
    p_session_id: body.session_id || null,
    p_awb_scanned: body.awb_scanned || null,
    p_device_info: body.device_info || null,
  });

  if (fnError) {
    return new Response(
      JSON.stringify({ error: fnError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const packResult = result as {
    success: boolean;
    code: string;
    message: string;
    packed_at?: string;
    packed_by?: string;
  };

  // HTTP status based on result
  let httpStatus = 200;
  if (!packResult.success) {
    switch (packResult.code) {
      case "ORDER_NOT_FOUND":
        httpStatus = 404;
        break;
      case "ORDER_CANCELLED":
        httpStatus = 409;
        break;
      case "ALREADY_PACKED":
        httpStatus = 409;
        break;
      case "LOCK_CONFLICT":
        httpStatus = 409;
        break;
      default:
        httpStatus = 422;
    }
  }

  return new Response(
    JSON.stringify(packResult),
    {
      status: httpStatus,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
