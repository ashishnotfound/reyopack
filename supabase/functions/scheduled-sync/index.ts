// supabase/functions/scheduled-sync/index.ts
// Scheduled sync triggered by pg_cron or Supabase Cron
// Calls the amazon-sync function internally

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import {
  spApiFetch,
  getMarketplaceId,
} from "../_shared/amazon-auth.ts";

// This function is a lightweight wrapper — it calls amazon-sync
// with a scheduled flag so auth checks are bypassed appropriately

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Verify this is called from Supabase cron (cron secret)
  const cronSecret = req.headers.get("x-cron-secret");
  const expectedSecret = Deno.env.get("CRON_SECRET");

  if (expectedSecret && cronSecret !== expectedSecret) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, serviceKey);

  const stats = {
    orders_scanned: 0,
    orders_created: 0,
    orders_updated: 0,
    orders_cancelled: 0,
    items_synced: 0,
    shipments_synced: 0,
    error_count: 0,
  };

  const startTime = Date.now();

  // Create sync run
  const { data: syncRun } = await db.from("sync_runs").insert({
    status: "RUNNING",
    triggered_by: null, // scheduled
    started_at: new Date().toISOString(),
    metadata: { source: "scheduled" },
  }).select().single();

  if (!syncRun) {
    return new Response(
      JSON.stringify({ error: "Failed to create sync run" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const syncId = syncRun.id;

  try {
    // Get last sync timestamp
    const { data: lastSyncSetting } = await db
      .from("system_settings")
      .select("value")
      .eq("key", "last_sync_at")
      .single();

    const lookbackHours = 2; // For scheduled syncs, only look back 2 hours
    const lastUpdateAfter = lastSyncSetting?.value
      ? new Date(lastSyncSetting.value).toISOString()
      : new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

    const marketplaceId = getMarketplaceId();

    // Fetch orders
    let nextToken: string | undefined;
    const allOrders = [];

    do {
      const params = new URLSearchParams({
        MarketplaceIds: marketplaceId,
        LastUpdatedAfter: lastUpdateAfter,
        OrderStatuses: "Unshipped,Pending,Shipped,Canceled,PartiallyShipped",
        MaxResultsPerPage: "100",
      });

      if (nextToken) params.set("NextToken", nextToken);

      const ordersRes = await spApiFetch(`/orders/v0/orders?${params.toString()}`);
      if (!ordersRes.ok) {
        throw new Error(`Orders fetch failed: ${ordersRes.status}`);
      }

      const data = await ordersRes.json();
      const orders = data.payload?.Orders || [];
      allOrders.push(...orders);
      nextToken = data.payload?.NextToken;

      if (nextToken) await sleep(1100); // Respect rate limit
    } while (nextToken);

    stats.orders_scanned = allOrders.length;

    // Delegate to the full sync logic (shared inline to avoid circular imports)
    // In production, invoke the amazon-sync function URL
    const syncFunctionUrl = `${supabaseUrl}/functions/v1/amazon-sync`;

    // Use internal service key header
    const syncRes = await fetch(syncFunctionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
        "x-scheduled-sync": "true",
      },
      body: JSON.stringify({ lookback_hours: lookbackHours }),
    });

    const syncResult = await syncRes.json();

    const duration = Date.now() - startTime;
    await db.from("sync_runs").update({
      status: "SUCCESS",
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      ...syncResult.stats,
    }).eq("id", syncId);

    await db.from("system_settings").upsert({
      key: "last_sync_at",
      value: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({ success: true, sync_run_id: syncId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    await db.from("sync_runs").update({
      status: "FAILED",
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      error_message: (err as Error).message,
    }).eq("id", syncId);

    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
