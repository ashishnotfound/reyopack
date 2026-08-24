import { getSupabasePublicKey } from '@/lib/config';
import { getSupabaseClient } from '@/lib/supabase/client';

type EdgeOptions = {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
};

export async function invokeSupabaseFunction<T = Record<string, unknown>>(
  functionName: string,
  options: EdgeOptions = {},
): Promise<{ response: Response; data: T }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = getSupabasePublicKey();
  if (!supabaseUrl || !publicKey) throw new Error('Supabase is not configured.');

  const { data: { session } } = await getSupabaseClient().auth.getSession();
  if (!session?.access_token) throw new Error('Authentication session expired.');

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: options.method || 'POST',
    headers: {
      apikey: publicKey,
      Authorization: `Bearer ${session.access_token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    cache: 'no-store',
  });

  const data = await response.json().catch(() => ({ error: 'The Supabase function returned an unreadable response.' }));
  return { response, data: data as T };
}
