import { isAmazonConfigured } from '@/lib/config';
import { errorResponse, requireUser } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { supabase } = await requireUser(['ADMIN']);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (supabaseUrl && publicKey) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const edgeResponse = await fetch(`${supabaseUrl}/functions/v1/amazon-status`, {
          headers: { apikey: publicKey, Authorization: `Bearer ${session.access_token}` },
          cache: 'no-store',
        });
        if (edgeResponse.ok) return Response.json(await edgeResponse.json());
      }
    }

    // Fallback is useful for local/Vercel-only setups. Return presence flags
    // only; values never leave the server or enter browser-accessible tables.
    const fields = {
      clientId: Boolean(process.env.AMAZON_CLIENT_ID),
      clientSecret: Boolean(process.env.AMAZON_CLIENT_SECRET),
      refreshToken: Boolean(process.env.AMAZON_SP_API_REFRESH_TOKEN),
      sellerId: Boolean(process.env.AMAZON_SELLER_ID),
      marketplaceId: Boolean(process.env.AMAZON_MARKETPLACE_ID || 'A21TJRUUN4KGV'),
      region: Boolean(process.env.AMAZON_SP_API_REGION || 'eu-west-1'),
    };

    return Response.json({
      configured: isAmazonConfigured(),
      fields,
      marketplaceId: process.env.AMAZON_MARKETPLACE_ID || 'A21TJRUUN4KGV',
      region: process.env.AMAZON_SP_API_REGION || 'eu-west-1',
      source: 'server-environment',
    });
  } catch (error) {
    return errorResponse(error);
  }
}
