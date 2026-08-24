// Scheduled sync wrapper for Supabase Cron/pg_cron.
// It delegates to amazon-sync so there is one synchronization implementation
// and one sync_runs record per scheduled execution.

import { corsHeaders, handleCors } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const expectedSecret = Deno.env.get("CRON_SECRET");
  const providedSecret = req.headers.get("x-cron-secret");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Supabase service configuration is incomplete" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/amazon-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
      "x-scheduled-sync": "true",
      "x-cron-secret": expectedSecret,
    },
    body: JSON.stringify({ lookback_hours: 48 }),
  });
  const payload = await response.text();
  return new Response(payload, {
    status: response.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
