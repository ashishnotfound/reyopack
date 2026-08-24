export const dynamic = 'force-dynamic';

async function runSync(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || request.headers.get('x-cron-secret');
  if (!secret || !provided || provided !== secret) return Response.json({ error: 'Unauthorized.' }, { status: 401 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !publicKey) return Response.json({ error: 'Supabase is not configured.' }, { status: 503 });

  const response = await fetch(`${supabaseUrl}/functions/v1/amazon-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: publicKey, 'x-scheduled-sync': 'true', 'x-cron-secret': secret },
    body: JSON.stringify({ lookback_hours: 48 }),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({ error: 'Scheduled sync returned an unreadable response.' }));
  return Response.json(payload, { status: response.status });
}

export const GET = runSync;
export const POST = runSync;
