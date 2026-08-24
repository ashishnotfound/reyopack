'use client';
// src/components/admin/SyncPanel.tsx
// Sync control panel for manually triggering Amazon SP-API synchronization

import { useState, useCallback, useEffect } from 'react';
import { RefreshCw, CheckCircle, AlertTriangle, Clock, Server } from 'lucide-react';
import { useRealtimeSyncRuns } from '@/lib/hooks/useRealtimeOrders';
import { formatDateTime, formatDuration } from '@/lib/utils/formatters';
import type { SyncRun } from '@/types/database.types';
import { invokeSupabaseFunction } from '@/lib/supabase/edge';

interface SyncPanelProps {
  initialSyncRun?: SyncRun | null;
  lastSyncAt?: string | null;
}

export function SyncPanel({ initialSyncRun, lastSyncAt }: SyncPanelProps) {
  const [syncing, setSyncing] = useState(false);
  const [currentRun, setCurrentRun] = useState<SyncRun | null>(initialSyncRun || null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(lastSyncAt || null);
  const [lookbackHours, setLookbackHours] = useState(48);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [amazonConfigured, setAmazonConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    invokeSupabaseFunction<{ configured?: boolean }>('amazon-status', { method: 'GET' })
      .then(({ response, data }) => setAmazonConfigured(response.ok && Boolean(data.configured)))
      .catch(() => setAmazonConfigured(false));
  }, []);

  // Subscribe to sync run status updates in realtime
  useRealtimeSyncRuns(
    useCallback((payload) => {
      const newRun = payload.new as SyncRun;
      setCurrentRun(newRun);
      if (newRun.status !== 'RUNNING') {
        setSyncing(false);
        if (newRun.status === 'SUCCESS' || newRun.status === 'PARTIAL') {
          setLastSyncTime(newRun.completed_at || new Date().toISOString());
        }
      }
    }, [])
  );

  const handleSyncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    setErrorMsg(null);

    try {
      const { response: res, data } = await invokeSupabaseFunction<{ error?: string }>('amazon-sync', {
        method: 'POST',
        body: { lookback_hours: lookbackHours },
      });
      if (!res.ok) {
        setErrorMsg(data.error || 'Synchronization failed to trigger');
        setSyncing(false);
      }
    } catch (err) {
      setErrorMsg(`Network error: ${(err as Error).message}`);
      setSyncing(false);
    }
  };

  return (
    <div className="card stack">
      <div className="row row--between">
        <div className="row">
          <Server size={20} color="var(--color-primary)" />
          <div>
            <h2 className="text-lg font-bold">Amazon SP-API Sync</h2>
            <p className="text-xs text-muted">
              Sync orders, items, Easy Ship shipments from Amazon India
            </p>
          </div>
        </div>
        {lastSyncTime && (
          <div className="text-xs text-muted text-right">
            <div>Last successful sync</div>
            <div className="font-mono font-semibold text-secondary">
              {formatDateTime(lastSyncTime)}
            </div>
          </div>
        )}
      </div>

      <div className={`card ${amazonConfigured ? 'card--success' : 'card--error'} text-sm font-semibold`}>
        AMAZON: {amazonConfigured === null ? 'CHECKING CONFIGURATION…' : amazonConfigured ? 'CONFIGURED — AWAITING SYNC HEALTH' : 'SERVER SECRETS REQUIRED'}
      </div>

      {errorMsg && (
        <div className="card card--error text-sm text-error">
          ⚠ {errorMsg}
        </div>
      )}

      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="form-group" style={{ flex: 1, minWidth: 160 }}>
          <label className="form-label" htmlFor="lookback-select">
            Lookback Window
          </label>
          <select
            id="lookback-select"
            className="form-input"
            value={lookbackHours}
            onChange={(e) => setLookbackHours(parseInt(e.target.value))}
            disabled={syncing}
          >
            <option value={12}>Last 12 hours</option>
            <option value={24}>Last 24 hours</option>
            <option value={48}>Last 48 hours (Recommended)</option>
            <option value={72}>Last 3 days</option>
            <option value={168}>Last 7 days</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', flex: 1, minWidth: 160 }}>
          <button
            className="btn btn--primary btn--full btn--lg"
            onClick={handleSyncNow}
            disabled={syncing || currentRun?.status === 'RUNNING'}
            id="btn-sync-now"
          >
            <RefreshCw size={18} className={syncing || currentRun?.status === 'RUNNING' ? 'spin' : ''} />
            {syncing || currentRun?.status === 'RUNNING' ? 'Synchronizing…' : 'SYNC NOW'}
          </button>
        </div>
      </div>

      {/* Current/Last Sync Status */}
      {currentRun && (
        <div className="card card--elevated p-4 stack stack--sm mt-2">
          <div className="row row--between">
            <div className="row">
              {currentRun.status === 'RUNNING' && <Clock size={16} className="spin text-pending" />}
              {currentRun.status === 'SUCCESS' && <CheckCircle size={16} color="var(--color-success)" />}
              {(currentRun.status === 'FAILED' || currentRun.status === 'PARTIAL') && (
                <AlertTriangle size={16} color="var(--color-error)" />
              )}
              <span className="font-semibold text-sm">
                Status: {currentRun.status}
              </span>
            </div>
            {currentRun.duration_ms && (
              <span className="text-xs text-muted font-mono">
                Took {formatDuration(currentRun.duration_ms)}
              </span>
            )}
          </div>

          <div className="row" style={{ gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
            <div>
              <span className="text-muted">Scanned:</span>{' '}
              <strong className="font-mono">{currentRun.orders_scanned}</strong>
            </div>
            <div>
              <span className="text-muted">Created:</span>{' '}
              <strong className="font-mono text-success">{currentRun.orders_created}</strong>
            </div>
            <div>
              <span className="text-muted">Updated:</span>{' '}
              <strong className="font-mono">{currentRun.orders_updated}</strong>
            </div>
            <div>
              <span className="text-muted">Cancelled:</span>{' '}
              <strong className="font-mono text-error">{currentRun.orders_cancelled}</strong>
            </div>
            {currentRun.error_count > 0 && (
              <div>
                <span className="text-muted">Errors:</span>{' '}
                <strong className="font-mono text-error">{currentRun.error_count}</strong>
              </div>
            )}
          </div>

          {currentRun.error_message && (
            <div className="text-xs text-error mt-1 font-mono">
              {currentRun.error_message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
