'use client';
// src/app/(app)/cancelled/page.tsx
// Cancelled Orders — Orders flagged as cancelled by Amazon SP-API sync

import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useRealtimeOrders } from '@/lib/hooks/useRealtimeOrders';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDateTime, truncate } from '@/lib/utils/formatters';
import type { Order } from '@/types/database.types';
import { AlertOctagon, RefreshCw } from 'lucide-react';

export default function CancelledPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCancelled = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('orders')
      .select(`
        *,
        order_items(*),
        shipments(*)
      `)
      .eq('status', 'CANCELLED')
      .order('cancelled_at', { ascending: false });

    setOrders((data as Order[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCancelled();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchCancelled]);

  useRealtimeOrders({
    onOrderUpdate: useCallback(() => fetchCancelled(), [fetchCancelled]),
  });

  return (
    <div className="stack">
      <div className="row row--between">
        <div>
          <h1 className="text-2xl font-extrabold text-error">Cancelled Orders</h1>
          <p className="text-sm text-secondary">
            {orders.length} orders cancelled by Amazon — blocked from packing
          </p>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={fetchCancelled} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {loading && orders.length === 0 ? (
        <div className="card text-center p-4">
          <div className="spinner" style={{ margin: '0 auto 8px' }} />
          <div className="text-sm text-secondary">Loading cancelled orders…</div>
        </div>
      ) : orders.length === 0 ? (
        <div className="empty-state card">
          <AlertOctagon size={48} color="var(--color-success)" />
          <h3 className="text-lg font-bold">No Cancelled Orders</h3>
          <p className="text-sm text-muted mt-1">
            All synchronized orders are currently active.
          </p>
        </div>
      ) : (
        <div className="stack stack--sm">
          {orders.map((order) => {
            const awb = order.shipments?.[0]?.awb_number;
            const items = order.order_items || [];

            return (
              <div key={order.id} className="card card--error fade-in">
                <div className="row row--between">
                  <div className="stack stack--sm">
                    <div className="row" style={{ gap: 8 }}>
                      <StatusBadge status="CANCELLED" />
                      <span className="font-mono text-sm font-bold">
                        #{order.amazon_order_id}
                      </span>
                    </div>

                    {items.length > 0 && (
                      <div className="text-sm font-semibold">
                        {truncate(items[0].title || items[0].amazon_sku || 'Item', 60)}
                      </div>
                    )}

                    <div className="row text-xs text-muted" style={{ gap: 12 }}>
                      <span>Cancelled: {formatDateTime(order.cancelled_at || order.updated_at)}</span>
                      {awb && <span className="font-mono text-secondary">AWB: {awb}</span>}
                    </div>
                  </div>

                  <div className="badge status-error" style={{ padding: '6px 12px', fontSize: 12 }}>
                    DO NOT PACK
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
