'use client';

import { useEffect, useState } from 'react';
import { ClipboardList, RefreshCw } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { formatDateTime, truncate } from '@/lib/utils/formatters';
import type { AuditLog } from '@/types/database.types';

type AuditWithActor = AuditLog & { actor?: { display_name: string | null; full_name: string } | null };

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditWithActor[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await getSupabaseClient()
      .from('audit_logs')
      .select('*, actor:profiles(display_name, full_name)')
      .order('created_at', { ascending: false })
      .limit(100);
    setLogs((data as AuditWithActor[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="stack">
      <div className="row row--between">
        <div><h1 className="text-2xl font-extrabold row"><ClipboardList size={24} /> Audit Log</h1><p className="text-sm text-secondary">Administrative and operational changes, newest first.</p></div>
        <button className="btn btn--ghost btn--sm" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh</button>
      </div>
      <div className="table-container">
        <table>
          <thead><tr><th>Time</th><th>Action</th><th>Table</th><th>Record</th><th>Actor</th><th>Details</th></tr></thead>
          <tbody>
            {logs.map((log) => <tr key={log.id}>
              <td className="font-mono text-xs">{formatDateTime(log.created_at)}</td>
              <td><span className="badge status-info">{log.action}</span></td>
              <td className="font-mono text-xs">{log.table_name}</td>
              <td className="font-mono text-xs">{log.record_id ? truncate(log.record_id, 18) : '—'}</td>
              <td>{log.actor?.display_name || log.actor?.full_name || 'System'}</td>
              <td className="text-xs text-muted">{log.metadata ? truncate(JSON.stringify(log.metadata), 80) : '—'}</td>
            </tr>)}
          </tbody>
        </table>
        {!loading && logs.length === 0 && <div className="empty-state p-4">No audit events recorded yet.</div>}
      </div>
    </div>
  );
}
