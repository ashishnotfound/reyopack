import { z } from 'zod';
import { errorResponse, requireUser } from '@/lib/server/auth';

const putawaySchema = z.object({
  sku_id: z.string().uuid(),
  location_id: z.string().uuid(),
  quantity: z.number().int().min(0).max(1_000_000).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(['PUTAWAY', 'ADMIN']);
    const body = putawaySchema.parse(await request.json());
    const rpc = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await rpc('upsert_sku_location', {
      p_sku_id: body.sku_id,
      p_location_id: body.location_id,
      p_quantity: body.quantity ?? null,
      p_put_by: user.id,
      p_notes: body.notes || null,
    });
    if (error) {
      console.error('[putaway.assign]', error);
      return Response.json({ error: 'Location assignment failed. Please retry.' }, { status: 500 });
    }
    return Response.json(data);
  } catch (error) {
    return errorResponse(error);
  }
}
