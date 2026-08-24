// Safe Amazon configuration status for the authenticated Admin screen.
// Secret values are read only from Edge Function environment variables and
// are reduced to boolean presence flags before leaving the function.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const authHeader = req.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

  if (!authHeader || !supabaseUrl || !serviceKey || !anonKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: jsonHeaders });
  }

  const db = createClient(supabaseUrl, serviceKey);
  const { data: profile } = await db
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .single();
  if (!profile?.is_active || profile.role !== "ADMIN") {
    return new Response(JSON.stringify({ error: "Admin role required" }), { status: 403, headers: jsonHeaders });
  }

  const fields = {
    clientId: Boolean(Deno.env.get("AMAZON_CLIENT_ID")),
    clientSecret: Boolean(Deno.env.get("AMAZON_CLIENT_SECRET")),
    refreshToken: Boolean(Deno.env.get("AMAZON_SP_API_REFRESH_TOKEN") || Deno.env.get("AMAZON_REFRESH_TOKEN")),
    sellerId: Boolean(Deno.env.get("AMAZON_SELLER_ID")),
    marketplaceId: Boolean(Deno.env.get("AMAZON_MARKETPLACE_ID") || "A21TJRUUN4KGV"),
    region: Boolean(Deno.env.get("AMAZON_SP_API_REGION") || "eu-west-1"),
  };

  return new Response(JSON.stringify({
    configured: fields.clientId && fields.clientSecret && fields.refreshToken && fields.sellerId,
    fields,
    marketplaceId: Deno.env.get("AMAZON_MARKETPLACE_ID") || "A21TJRUUN4KGV",
    region: Deno.env.get("AMAZON_SP_API_REGION") || "eu-west-1",
    source: "supabase-edge-secrets",
  }), { status: 200, headers: jsonHeaders });
});
