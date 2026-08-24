import { isAmazonConfigured, isSupabaseConfigured } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    status: 'ok',
    app: 'reyo-pack',
    configured: {
      supabase: isSupabaseConfigured(),
      amazon: isAmazonConfigured(),
    },
    timestamp: new Date().toISOString(),
  });
}
