import { z } from 'zod';
import { normalizeBarcode } from '@/lib/domain/awb';
import { errorResponse, requireUser } from '@/lib/server/auth';

const packingSchema = z.object({
  action: z.enum(['PACKED', 'CHECKING']),
  amazon_order_id: z.string().min(1).max(80),
  session_id: z.string().uuid().nullable().optional(),
  awb_scanned: z.string().max(160).nullable().optional(),
  device_info: z.string().max(500).nullable().optional(),
  idempotency_key: z.string().min(8).max(160).nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(['PACKER', 'ADMIN']);
    const body = packingSchema.parse(await request.json());
    const awb = body.awb_scanned ? normalizeBarcode(body.awb_scanned) : null;
    const rpc = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

    if (body.action === 'PACKED') {
      const { data, error } = await rpc('atomic_pack_order', {
        p_amazon_order_id: body.amazon_order_id,
        p_packer_id: user.id,
        p_session_id: body.session_id || null,
        p_awb_scanned: awb,
        p_device_info: body.device_info || null,
        p_idempotency_key: body.idempotency_key || null,
      });
      if (error) {
        console.error('[packing.pack]', error);
        return Response.json({ error: 'Packing transaction failed. Please retry.' }, { status: 500 });
      }
      const result = data as { success: boolean; code?: string; message?: string };
      return Response.json(result, { status: result.success ? 200 : result.code === 'ALREADY_PACKED' || result.code === 'ORDER_CANCELLED' ? 409 : 422 });
    }

    const { data, error } = await rpc('atomic_check_order', {
      p_amazon_order_id: body.amazon_order_id,
      p_packer_id: user.id,
      p_session_id: body.session_id || null,
      p_awb_scanned: awb,
      p_device_info: body.device_info || null,
    });
    if (error) {
      console.error('[packing.check]', error);
      return Response.json({ error: 'Checking transaction failed. Please retry.' }, { status: 500 });
    }
    const result = data as { success: boolean; code?: string; message?: string };
    return Response.json(result, { status: result.success ? 200 : 409 });
  } catch (error) {
    return errorResponse(error);
  }
}
