import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireUser, errorResponse } from '@/lib/server/auth';
import type { Database } from '@/types/database.types';

const bootstrapSchema = z.object({ token: z.string().trim().min(1).max(512) });

function tokensMatch(provided: string, expected: string) {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    const expectedToken = process.env.ADMIN_BOOTSTRAP_TOKEN;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (!expectedToken || !serviceRoleKey || !supabaseUrl) {
      return Response.json(
        { error: 'First-admin setup is not enabled for this deployment.' },
        { status: 503 },
      );
    }

    const parsed = bootstrapSchema.safeParse(await request.json());
    if (!parsed.success || !tokensMatch(parsed.data.token, expectedToken)) {
      return Response.json({ error: 'The first-admin setup token is invalid.' }, { status: 403 });
    }

    const serviceSupabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const callBootstrap = serviceSupabase.rpc as unknown as (
      functionName: string,
      args: { p_user_id: string },
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await callBootstrap('bootstrap_first_admin', { p_user_id: user.id });

    if (error) throw error;

    const result = data as { success?: boolean; code?: string; message?: string } | null;
    if (!result?.success) {
      return Response.json(
        { error: result?.message || 'First-admin setup could not be completed.' },
        { status: result?.code === 'ADMIN_EXISTS' ? 409 : 400 },
      );
    }

    return Response.json({ success: true, message: result.message });
  } catch (error) {
    return errorResponse(error);
  }
}
