// supabase/functions/_shared/cors.ts
// Shared CORS headers for all edge functions

export const corsHeaders = {
  // The APK runs from Capacitor's localhost origin, while the optional web
  // client may use a different origin. These endpoints authenticate every
  // request with a bearer token, so a wildcard origin is safe here and keeps
  // the same Edge Functions usable from both clients.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
