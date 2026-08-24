// supabase/functions/ship-order/index.ts
// Backwards-compatible Edge Function alias for the PACKED transaction.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

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

  let body: { amazon_order_id: string; session_id?: string; awb_scanned?: string; device_info?: string; idempotency_key?: string };
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

  const { data: result, error: fnError } = await db.rpc("atomic_pack_order", {
    p_amazon_order_id: body.amazon_order_id,
    p_packer_id: user.id,
    p_session_id: body.session_id || null,
    p_awb_scanned: body.awb_scanned || null,
    p_device_info: body.device_info || null,
    p_idempotency_key: body.idempotency_key || null,
  });

  if (fnError) {
    return new Response(
      JSON.stringify({ error: fnError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify(result),
    { status: result.success ? 200 : 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
