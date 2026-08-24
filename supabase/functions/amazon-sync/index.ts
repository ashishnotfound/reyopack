// supabase/functions/amazon-sync/index.ts
// Amazon SP-API synchronization Edge Function
// Fetches orders, items, Easy Ship shipments and upserts into Supabase PostgreSQL
// All Amazon credentials come from Supabase secrets — never exposed to client

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import {
  spApiFetch,
  getMarketplaceId,
} from "../_shared/amazon-auth.ts";

// ============================================================
// SP-API Types (subset)
// ============================================================

interface SpApiOrder {
  AmazonOrderId: string;
  PurchaseDate: string;
  LastUpdateDate: string;
  OrderStatus: string;
  FulfillmentChannel: string;
  SalesChannel: string;
  OrderChannel?: string;
  ShipServiceLevel?: string;
  IsBusinessOrder?: boolean;
  IsPrime?: boolean;
  IsReplacementOrder?: boolean;
  BuyerInfo?: {
    BuyerName?: string;
    BuyerEmail?: string;
  };
  ShippingAddress?: {
    City?: string;
    StateOrRegion?: string;
    PostalCode?: string;
    CountryCode?: string;
  };
  OrderTotal?: { Amount: string; CurrencyCode: string };
  NumberOfItemsShipped?: number;
  NumberOfItemsUnshipped?: number;
  EasyShipShipmentStatus?: string;
}

interface SpApiOrderItem {
  AmazonOrderItemId: string;
  SellerSKU: string;
  ASIN: string;
  Title: string;
  QuantityOrdered: number;
  QuantityShipped: number;
  ItemPrice?: { Amount: string; CurrencyCode: string };
  ItemTax?: { Amount: string; CurrencyCode: string };
  ConditionId?: string;
  ConditionNote?: string;
}

interface EasyShipPackage {
  scheduledPackageId?: { amazonOrderId: string; packageId?: string };
  packageStatus?: string;
  trackingDetails?: { trackingId?: string };
  packageDimensions?: { length: number; width: number; height: number; unit: string };
  packageWeight?: { value: number; unit: string };
}

// Map Amazon order status → our enum
function mapOrderStatus(amazonStatus: string): string {
  const map: Record<string, string> = {
    Unshipped: "UNSHIPPED",
    Pending: "PENDING",
    PartiallyShipped: "PENDING",
    Shipped: "SHIPPED",
    Canceled: "CANCELLED",
    InvoiceUnconfirmed: "PENDING",
    Unfulfillable: "CANCELLED",
    PendingAvailability: "PENDING",
  };
  return map[amazonStatus] || "PENDING";
}

// ============================================================
// MAIN HANDLER
// ============================================================

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const isScheduled = req.headers.get("x-scheduled-sync") === "true";
  const cronSecret = Deno.env.get("CRON_SECRET");
  const scheduledAuthorized = isScheduled && Boolean(cronSecret) && req.headers.get("x-cron-secret") === cronSecret;

  // Verify caller is authenticated for manual runs, or verify the dedicated
  // cron secret for scheduled runs.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader && !scheduledAuthorized) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Create Supabase client with SERVICE ROLE for database writes
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, serviceKey);

  let userId: string | null = null;
  let profile: { role: string; is_active: boolean } | null = null;
  if (!scheduledAuthorized) {
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader! } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    userId = user.id;
    const { data } = await db.from("profiles").select("role, is_active").eq("id", user.id).single();
    profile = data;
  }

  // Parse optional parameters from request body
  let body: { lookback_hours?: number; force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // No body or not JSON — use defaults
  }

  if (!scheduledAuthorized && (!profile || profile.role !== "ADMIN" || !profile.is_active)) {
    return new Response(
      JSON.stringify({ error: "Forbidden: Admin role required" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Create sync run record
  const { data: syncRun, error: syncRunError } = await db
    .from("sync_runs")
    .insert({
      status: "RUNNING",
      triggered_by: scheduledAuthorized ? null : userId,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (syncRunError || !syncRun) {
    return new Response(
      JSON.stringify({ error: "Failed to create sync run" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const syncId = syncRun.id;
  const stats = {
    orders_scanned: 0,
    orders_created: 0,
    orders_updated: 0,
    orders_cancelled: 0,
    items_synced: 0,
    shipments_synced: 0,
    error_count: 0,
  };

  // Stream response (sync can take time)
  const startTime = Date.now();

  try {
    // Get lookback window from settings or request
    const lookbackHours = body.lookback_hours || 48;
    const lastUpdateAfter = new Date(
      Date.now() - lookbackHours * 60 * 60 * 1000
    ).toISOString();

    const marketplaceId = await getMarketplaceId(db);

    // Fetch all orders page by page
    let nextToken: string | undefined;
    const allOrders: SpApiOrder[] = [];

    do {
      const params = new URLSearchParams({
        MarketplaceIds: marketplaceId,
        LastUpdatedAfter: lastUpdateAfter,
        OrderStatuses: "Unshipped,Pending,Shipped,Canceled,PartiallyShipped",
        MaxResultsPerPage: "100",
      });

      if (nextToken) params.set("NextToken", nextToken);

      const ordersRes = await spApiFetch(
        `/orders/v0/orders?${params.toString()}`
      );

      if (!ordersRes.ok) {
        const errText = await ordersRes.text();
        throw new Error(`Orders fetch failed: ${ordersRes.status} ${errText}`);
      }

      const ordersData = await ordersRes.json();
      const page: SpApiOrder[] = ordersData.payload?.Orders || [];
      allOrders.push(...page);
      nextToken = ordersData.payload?.NextToken;

      // Rate limit: 1 req/sec for orders endpoint
      if (nextToken) await sleep(1000);
    } while (nextToken);

    stats.orders_scanned = allOrders.length;

    // Process each order
    for (const spOrder of allOrders) {
      try {
        await processOrder(db, spOrder, syncId, stats);
      } catch (err) {
        stats.error_count++;
        await db.from("sync_errors").insert({
          sync_run_id: syncId,
          amazon_order_id: spOrder.AmazonOrderId,
          error_message: (err as Error).message,
          raw_data: spOrder,
        });
      }

      // Throttle per Amazon rate limits
      await sleep(200);
    }

    // Update sync run as success
    const duration = Date.now() - startTime;
    await db.from("sync_runs").update({
      status: stats.error_count > 0 && stats.orders_created + stats.orders_updated === 0
        ? "FAILED"
        : stats.error_count > 0
        ? "PARTIAL"
        : "SUCCESS",
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      ...stats,
    }).eq("id", syncId);

    // Update last sync timestamp in settings
    await db.from("system_settings").upsert({
      key: "last_sync_at",
      value: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Broadcast sync completion via Realtime
    await db.channel("admin").send({
      type: "broadcast",
      event: "sync_completed",
      payload: { sync_run_id: syncId, stats, duration_ms: duration },
    });

    return new Response(
      JSON.stringify({ success: true, sync_run_id: syncId, stats }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    await db.from("sync_runs").update({
      status: "FAILED",
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      error_message: (err as Error).message,
      ...stats,
    }).eq("id", syncId);

    return new Response(
      JSON.stringify({ error: (err as Error).message, sync_run_id: syncId }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ============================================================
// Process a single Amazon order
// ============================================================

async function processOrder(
  db: ReturnType<typeof createClient>,
  spOrder: SpApiOrder,
  syncId: string,
  stats: Record<string, number>
): Promise<void> {
  const status = mapOrderStatus(spOrder.OrderStatus);

  // Upsert the order
  const orderData = {
    amazon_order_id: spOrder.AmazonOrderId,
    status: status,
    purchase_date: spOrder.PurchaseDate,
    last_update_date: spOrder.LastUpdateDate,
    fulfillment_channel: spOrder.FulfillmentChannel,
    sales_channel: spOrder.SalesChannel,
    order_channel: spOrder.OrderChannel,
    ship_service_level: spOrder.ShipServiceLevel,
    is_business_order: spOrder.IsBusinessOrder || false,
    is_prime: spOrder.IsPrime || false,
    is_replacement_order: spOrder.IsReplacementOrder || false,
    buyer_name: spOrder.BuyerInfo?.BuyerName,
    buyer_email: spOrder.BuyerInfo?.BuyerEmail,
    ship_city: spOrder.ShippingAddress?.City,
    ship_state: spOrder.ShippingAddress?.StateOrRegion,
    ship_postal_code: spOrder.ShippingAddress?.PostalCode,
    ship_country: spOrder.ShippingAddress?.CountryCode,
    order_total_amount: spOrder.OrderTotal
      ? parseFloat(spOrder.OrderTotal.Amount)
      : null,
    order_total_currency: spOrder.OrderTotal?.CurrencyCode,
    number_of_items_shipped: spOrder.NumberOfItemsShipped || 0,
    number_of_items_unshipped: spOrder.NumberOfItemsUnshipped || 0,
    cancelled_at: status === "CANCELLED" ? new Date().toISOString() : null,
    amazon_raw: spOrder,
    updated_at: new Date().toISOString(),
  };

  const { data: existingOrder } = await db
    .from("orders")
    .select("id, status, packed_at")
    .eq("amazon_order_id", spOrder.AmazonOrderId)
    .single();

  let orderId: string;

  if (!existingOrder) {
    const { data: newOrder, error } = await db
      .from("orders")
      .insert(orderData)
      .select("id")
      .single();

    if (error) throw new Error(`Insert order failed: ${error.message}`);
    orderId = newOrder!.id;
    stats.orders_created++;
  } else {
    orderId = existingOrder.id;

    // Don't overwrite packed status if already packed
    const updateData = { ...orderData } as Record<string, unknown>;
    if (status === "CANCELLED") {
      if (existingOrder.status === "CANCELLED") delete updateData.cancelled_at;
      else updateData.cancelled_at = new Date().toISOString();
    } else {
      delete updateData.cancelled_at;
    }
    if (existingOrder.status === "PACKED" && status !== "CANCELLED") {
      delete updateData.status;
    }

    const { error } = await db
      .from("orders")
      .update(updateData)
      .eq("id", orderId);

    if (error) throw new Error(`Update order failed: ${error.message}`);

    if (status === "CANCELLED") stats.orders_cancelled++;
    else stats.orders_updated++;
  }

  if (status === "CANCELLED" && (!existingOrder || existingOrder.status !== "CANCELLED")) {
    await db.from("packing_events").insert({
      order_id: orderId,
      packed_by: null,
      event_type: "CANCELLED",
      notes: "Amazon cancellation observed during synchronization",
      packed_at: new Date().toISOString(),
    });
  }

  // Fetch and upsert order items
  await syncOrderItems(db, orderId, spOrder.AmazonOrderId, stats);

  // Fetch Easy Ship data
  if (
    spOrder.FulfillmentChannel === "MFN" ||
    spOrder.EasyShipShipmentStatus !== undefined
  ) {
    await syncEasyShipData(db, orderId, spOrder.AmazonOrderId, stats);
  }
}

// ============================================================
// Sync Order Items
// ============================================================

async function syncOrderItems(
  db: ReturnType<typeof createClient>,
  orderId: string,
  amazonOrderId: string,
  stats: Record<string, number>
): Promise<void> {
  const itemsRes = await spApiFetch(
    `/orders/v0/orders/${amazonOrderId}/orderItems`
  );

  if (!itemsRes.ok) {
    throw new Error(`Order items fetch failed: ${itemsRes.status}`);
  }

  const itemsData = await itemsRes.json();
  const items: SpApiOrderItem[] = itemsData.payload?.OrderItems || [];

  for (const item of items) {
    // Try to find matching SKU
    const { data: sku } = await db
      .from("skus")
      .select("id")
      .eq("amazon_sku", item.SellerSKU)
      .single();

    const itemData = {
      order_id: orderId,
      amazon_order_item_id: item.AmazonOrderItemId,
      sku_id: sku?.id || null,
      amazon_sku: item.SellerSKU,
      asin: item.ASIN,
      title: item.Title,
      quantity_ordered: item.QuantityOrdered,
      quantity_shipped: item.QuantityShipped,
      item_price_amount: item.ItemPrice
        ? parseFloat(item.ItemPrice.Amount)
        : null,
      item_price_currency: item.ItemPrice?.CurrencyCode,
      item_tax_amount: item.ItemTax
        ? parseFloat(item.ItemTax.Amount)
        : null,
      condition_id: item.ConditionId,
      condition_note: item.ConditionNote,
      amazon_raw: item,
      updated_at: new Date().toISOString(),
    };

    await db.from("order_items").upsert(itemData, {
      onConflict: "order_id,amazon_order_item_id",
    });

    stats.items_synced++;
  }
}

// ============================================================
// Sync Easy Ship shipment data (AWB + label)
// ============================================================

async function syncEasyShipData(
  db: ReturnType<typeof createClient>,
  orderId: string,
  amazonOrderId: string,
  stats: Record<string, number>
): Promise<void> {
  try {
    // Try Easy Ship v2022-03-23 API first
    const esRes = await spApiFetch(
      `/easyShip/2022-03-23/packages?amazonOrderId=${amazonOrderId}`
    );

    if (esRes.ok) {
      const esData = await esRes.json();
      const packages: EasyShipPackage[] = esData.packages || [];

      for (const pkg of packages) {
        const trackingId = pkg.trackingDetails?.trackingId;

        const shipmentData = {
          order_id: orderId,
          amazon_shipment_id: pkg.scheduledPackageId?.packageId || null,
          awb_number: trackingId || null,
          tracking_number: trackingId || null,
          carrier: "Amazon Easy Ship",
          ship_method: "EasyShip",
          shipment_status: pkg.packageStatus || null,
          amazon_raw: pkg,
          updated_at: new Date().toISOString(),
        };

        const shipmentId = shipmentData.amazon_shipment_id;
        const existing = shipmentId
          ? await db.from("shipments").select("id").eq("amazon_shipment_id", shipmentId).maybeSingle()
          : await db.from("shipments").select("id").eq("order_id", orderId).eq("awb_number", trackingId || "").maybeSingle();
        if (existing.data?.id) {
          const { error } = await db.from("shipments").update(shipmentData).eq("id", existing.data.id);
          if (error) throw new Error(`Shipment update failed: ${error.message}`);
        } else {
          const { error } = await db.from("shipments").insert(shipmentData);
          if (error) throw new Error(`Shipment insert failed: ${error.message}`);
        }

        stats.shipments_synced++;
      }
    }
  } catch {
    // Easy Ship data might not be available yet — not a fatal error
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
