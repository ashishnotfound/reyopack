import { z } from 'zod';
import { errorResponse, requireUser } from '@/lib/server/auth';

const labelSchema = z.object({ amazon_order_id: z.string().min(1).max(80), package_id: z.string().max(160).nullable().optional() });

export async function POST(request: Request) {
  try {
    const { user } = await requireUser(['PACKER', 'ADMIN', 'VIEWER']);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !publicKey) return Response.json({ error: 'Supabase is not configured.' }, { status: 503 });

    const body = labelSchema.parse(await request.json());
    const supabase = await (await import('@/lib/supabase/server')).createServerSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return Response.json({ error: 'Authentication session expired.' }, { status: 401 });

    const response = await fetch(`${supabaseUrl}/functions/v1/get-shipping-label`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: publicKey, Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ ...body, requested_by: user.id }),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({ error: 'Amazon returned an unreadable label response.' }));
    return Response.json(payload, { status: response.status });
  } catch (error) {
    return errorResponse(error);
  }
}
