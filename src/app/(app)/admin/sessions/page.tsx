'use client';

import { useEffect, useState } from 'react';
import { ClipboardList, RefreshCw } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { formatDateTime, formatDuration } from '@/lib/utils/formatters';
import type { PackingSession } from '@/types/database.types';

type SessionWithPacker = PackingSession & { packer?: { display_name: string | null; full_name: string } | null };

export default function AdminSessionsPage() {
  const [sessions, setSessions] = useState<SessionWithPacker[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await getSupabaseClient()
      .from('packing_sessions')
      .select('*, packer:profiles(display_name, full_name)')
      .order('started_at', { ascending: false })
      .limit(100);
    setSessions((data as SessionWithPacker[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="stack">
      <div className="row row--between">
        <div><h1 className="text-2xl font-extrabold row"><ClipboardList size={24} /> Packing Sessions</h1><p className="text-sm text-secondary">Operator throughput and session history.</p></div>
        <button className="btn btn--ghost btn--sm" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh</button>
      </div>
      <div className="table-container">
        <table>
          <thead><tr><th>Started</th><th>Operator</th><th>Status</th><th>Packages</th><th>Units</th><th>Duration</th></tr></thead>
          <tbody>
            {sessions.map((session) => {
              const duration = session.ended_at
                ? new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()
                : null;
              return <tr key={session.id}>
                <td className="font-mono text-xs">{formatDateTime(session.started_at)}</td>
                <td>{session.packer?.display_name || session.packer?.full_name || '—'}</td>
                <td><span className={`badge ${session.ended_at ? 'status-neutral' : 'status-success'}`}>{session.ended_at ? 'COMPLETE' : 'ACTIVE'}</span></td>
                <td className="font-mono">{session.orders_packed}</td>
                <td className="font-mono">{session.units_packed}</td>
                <td className="font-mono text-xs">{duration === null ? 'Active' : formatDuration(duration)}</td>
              </tr>;
            })}
          </tbody>
        </table>
        {!loading && sessions.length === 0 && <div className="empty-state p-4">No sessions recorded yet.</div>}
      </div>
    </div>
  );
}
