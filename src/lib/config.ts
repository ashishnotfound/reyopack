export function getSupabasePublicKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && getSupabasePublicKey());
}

export function isAmazonConfigured(): boolean {
  return Boolean(
    process.env.AMAZON_CLIENT_ID &&
      process.env.AMAZON_CLIENT_SECRET &&
      process.env.AMAZON_SP_API_REFRESH_TOKEN &&
      process.env.AMAZON_SELLER_ID &&
      process.env.AMAZON_MARKETPLACE_ID,
  );
}
