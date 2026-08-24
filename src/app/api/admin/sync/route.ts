import { z } from 'zod';
import { errorResponse, requireUser } from '@/lib/server/auth';

const syncSchema = z.object({ lookback_hours: z.number().int().min(1).max(720).default(48), force: z.boolean().optional() });

export async function POST(request: Request) {
  try {
    const { user } = await requireUser(['ADMIN']);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !publicKey) return Response.json({ error: 'Supabase is not configured.' }, { status: 503 });

    const body = syncSchema.parse(await request.json().catch(() => ({})));
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    const supabase = await createServerSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return Response.json({ error: 'Authentication session expired.' }, { status: 401 });

    const response = await fetch(`${supabaseUrl}/functions/v1/amazon-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: publicKey, Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ ...body, requested_by: user.id }),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({ error: 'Amazon sync returned an unreadable response.' }));
    return Response.json(payload, { status: response.status });
  } catch (error) {
    return errorResponse(error);
  }
}
