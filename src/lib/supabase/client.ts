// src/lib/supabase/client.ts
// Browser-side Supabase client with defensive fallback for Vercel deployment

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database.types';
import { getSupabasePublicKey } from '@/lib/config';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
  const anonKey = getSupabasePublicKey() || 'placeholder-anon-key';

  return createBrowserClient<Database>(url, anonKey);
}

// Singleton for use in hooks/components
let browserClient: ReturnType<typeof createClient> | null = null;

export function getSupabaseClient() {
  if (!browserClient) {
    browserClient = createClient();
  }
  return browserClient;
}
