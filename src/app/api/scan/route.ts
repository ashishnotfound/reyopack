import { z } from 'zod';
import { normalizeAwb } from '@/lib/domain/awb';
import { errorResponse, requireUser } from '@/lib/server/auth';

const scanSchema = z.object({ awb: z.string().min(1).max(160) });

export async function POST(request: Request) {
  try {
    const { supabase } = await requireUser();
    const body = scanSchema.parse(await request.json());
    const awb = normalizeAwb(body.awb);
    const rpc = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await rpc('lookup_order_by_awb', { p_awb: awb });

    if (error) {
      console.error('[scan.lookup]', error);
      return Response.json({ error: 'Shipment lookup failed. Please retry.' }, { status: 500 });
    }

    const result = data as { found?: boolean; message?: string };
    if (!result?.found) {
      return Response.json({ error: result?.message || `No shipment matches AWB: ${awb}`, code: 'BARCODE_NOT_FOUND' }, { status: 404 });
    }

    return Response.json({ ...result, awb });
  } catch (error) {
    return errorResponse(error);
  }
}
