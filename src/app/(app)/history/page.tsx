'use client';
// src/app/(app)/history/page.tsx
// Packing History — Audit log of all completed packing events

import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { formatDateTime, truncate } from '@/lib/utils/formatters';
import type { PackingEvent } from '@/types/database.types';
import { CheckCircle2, RefreshCw } from 'lucide-react';

export default function HistoryPage() {
  const [events, setEvents] = useState<PackingEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('packing_events')
      .select(`
        *,
        order:orders(*, order_items(*)),
        packer:profiles(*)
      `)
      .order('packed_at', { ascending: false })
      .limit(50);

    setEvents((data as PackingEvent[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchHistory();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchHistory]);

  return (
    <div className="stack">
      <div className="row row--between">
        <div>
          <h1 className="text-2xl font-extrabold">Packing History</h1>
          <p className="text-sm text-secondary">
            Recent {events.length} completed packing events
          </p>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={fetchHistory} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {loading && events.length === 0 ? (
        <div className="card text-center p-4">
          <div className="spinner" style={{ margin: '0 auto 8px' }} />
          <div className="text-sm text-secondary">Loading packing history…</div>
        </div>
      ) : events.length === 0 ? (
        <div className="empty-state card">
          <CheckCircle2 size={48} color="var(--text-muted)" />
          <h3 className="text-lg font-bold">No Packing Events Yet</h3>
          <p className="text-sm text-muted mt-1">
            Orders packed on any device will appear here in real-time.
          </p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Packed At</th>
                <th>Order ID</th>
                <th>AWB Scanned</th>
                <th>Items / SKU</th>
                <th>Packed By</th>
              </tr>
            </thead>
            <tbody>
              {events.map((evt) => {
                const order = evt.order;
                const packer = evt.packer;
                const items = order?.order_items || [];

                return (
                  <tr key={evt.id}>
                    <td className="font-mono text-xs text-secondary white-space-nowrap">
                      {formatDateTime(evt.packed_at)}
                    </td>
                    <td className="font-mono font-bold text-sm">
                      #{order?.amazon_order_id || '—'}
                    </td>
                    <td className="font-mono text-xs text-muted">
                      {evt.awb_scanned || '—'}
                    </td>
                    <td>
                      {items.length > 0 ? (
                        <div>
                          <div className="font-semibold text-sm">
                            {truncate(items[0].title || items[0].amazon_sku || 'Product', 40)}
                          </div>
                          {items.length > 1 && (
                            <div className="text-xs text-muted">+{items.length - 1} more items</div>
                          )}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-sm">
                      {packer ? packer.display_name || packer.full_name : 'System'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
