'use client';
// src/app/(app)/putaway/history/page.tsx
// Putaway History — Log of all SKU location movements

import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { formatDateTime } from '@/lib/utils/formatters';
import type { PutawayEvent } from '@/types/database.types';
import { Archive, RefreshCw } from 'lucide-react';

export default function PutawayHistoryPage() {
  const [events, setEvents] = useState<PutawayEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('putaway_events')
      .select(`
        *,
        sku:skus(*),
        from_location:warehouse_locations!putaway_events_from_location_id_fkey(*),
        to_location:warehouse_locations!putaway_events_to_location_id_fkey(*),
        putter:profiles(*)
      `)
      .order('put_at', { ascending: false })
      .limit(50);

    setEvents((data as PutawayEvent[]) || []);
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
          <h1 className="text-2xl font-extrabold">Putaway History</h1>
          <p className="text-sm text-secondary">
            Log of SKU location assignments and movements
          </p>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={fetchHistory} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {loading && events.length === 0 ? (
        <div className="card text-center p-4">
          <div className="spinner" style={{ margin: '0 auto 8px' }} />
          <div className="text-sm text-secondary">Loading putaway history…</div>
        </div>
      ) : events.length === 0 ? (
        <div className="empty-state card">
          <Archive size={48} color="var(--text-muted)" />
          <h3 className="text-lg font-bold">No Location Events</h3>
          <p className="text-sm text-muted mt-1">
            Putaway location changes will be logged here.
          </p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>SKU</th>
                <th>Action</th>
                <th>From</th>
                <th>To Location</th>
                <th>Qty</th>
                <th>Assigned By</th>
              </tr>
            </thead>
            <tbody>
              {events.map((evt) => {
                const sku = evt.sku;
                const fromLoc = evt.from_location;
                const toLoc = evt.to_location;
                const putter = evt.putter;

                return (
                  <tr key={evt.id}>
                    <td className="font-mono text-xs text-secondary white-space-nowrap">
                      {formatDateTime(evt.put_at)}
                    </td>
                    <td className="font-mono font-bold text-sm">
                      {sku?.amazon_sku || '—'}
                    </td>
                    <td>
                      <span className="badge status-info">{evt.action}</span>
                    </td>
                    <td className="font-mono text-xs text-muted">
                      {fromLoc ? fromLoc.code : '—'}
                    </td>
                    <td className="font-mono font-bold text-sm text-primary">
                      {toLoc ? toLoc.code : '—'}
                    </td>
                    <td className="font-mono text-sm">{evt.quantity ?? '—'}</td>
                    <td className="text-sm">
                      {putter ? putter.display_name || putter.full_name : 'System'}
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
