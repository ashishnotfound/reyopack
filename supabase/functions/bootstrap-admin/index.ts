import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Authentication required." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Invalid authentication session." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const db = createClient(supabaseUrl, serviceKey);
  const { data, error } = await db.rpc("bootstrap_first_admin", { p_user_id: user.id });
  if (error) {
    return new Response(JSON.stringify({ error: "Administrator setup failed." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const result = data as { success?: boolean; code?: string; message?: string };
  return new Response(JSON.stringify(result), {
    status: result.success ? 200 : result.code === "ADMIN_EXISTS" ? 409 : 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
