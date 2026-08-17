'use client';
// src/app/(app)/queue/page.tsx
// Packing Queue — Orders waiting to be packed

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useRealtimeOrders } from '@/lib/hooks/useRealtimeOrders';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDateTime, truncate } from '@/lib/utils/formatters';
import type { Order } from '@/types/database.types';
import { RefreshCw, ArrowRight, Package } from 'lucide-react';

export default function QueuePage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('orders')
      .select(`
        *,
        order_items(*, skus(*)),
        shipments(*)
      `)
      .in('status', ['PENDING', 'UNSHIPPED'])
      .order('purchase_date', { ascending: true });

    setOrders((data as Order[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchQueue();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchQueue]);

  // Realtime updates
  useRealtimeOrders({
    onOrderUpdate: useCallback(() => fetchQueue(), [fetchQueue]),
    onOrderInsert: useCallback(() => fetchQueue(), [fetchQueue]),
    onPackingEvent: useCallback(() => fetchQueue(), [fetchQueue]),
  });

  return (
    <div className="stack">
      <div className="row row--between">
        <div>
          <h1 className="text-2xl font-extrabold">Packing Queue</h1>
          <p className="text-sm text-secondary">
            {orders.length} order{orders.length === 1 ? '' : 's'} waiting to be packed
          </p>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={fetchQueue} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {loading && orders.length === 0 ? (
        <div className="card text-center p-4">
          <div className="spinner" style={{ margin: '0 auto 8px' }} />
          <div className="text-sm text-secondary">Loading queue…</div>
        </div>
      ) : orders.length === 0 ? (
        <div className="empty-state card">
          <Package size={48} color="var(--text-muted)" />
          <h3 className="text-lg font-bold">Queue is Empty</h3>
          <p className="text-sm text-muted mt-1">
            No pending orders to pack at this moment.
          </p>
        </div>
      ) : (
        <div className="stack stack--sm">
          {orders.map((order) => {
            const awb = order.shipments?.[0]?.awb_number;
            const itemCount = order.order_items?.reduce((sum, item) => sum + item.quantity_ordered, 0) || 0;

            return (
              <div key={order.id} className="card hover-card fade-in">
                <div className="row row--between">
                  <div className="stack stack--sm">
                    <div className="row" style={{ gap: 8 }}>
                      <StatusBadge status={order.status} />
                      <span className="font-mono text-sm font-bold">
                        #{order.amazon_order_id}
                      </span>
                    </div>
                    {order.order_items && order.order_items.length > 0 && (
                      <div className="text-sm font-semibold text-primary">
                        {truncate(order.order_items[0].title || order.order_items[0].amazon_sku || 'Item', 60)}
                        {order.order_items.length > 1 && (
                          <span className="text-muted text-xs"> (+{order.order_items.length - 1} more)</span>
                        )}
                      </div>
                    )}
                    <div className="row text-xs text-muted" style={{ gap: 12 }}>
                      <span>Date: {formatDateTime(order.purchase_date)}</span>
                      <span>Items: {itemCount}</span>
                      {awb && <span className="font-mono text-secondary">AWB: {awb}</span>}
                    </div>
                  </div>

                  <Link href={`/scan?awb=${awb || ''}`} className="btn btn--primary btn--sm">
                    Pack <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
