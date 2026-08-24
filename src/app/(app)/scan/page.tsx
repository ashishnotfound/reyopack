'use client';
// src/app/(app)/scan/page.tsx
// PRIMARY PACKING PAGE — Scan AWB → Visual Verification → PACKED → Record → Next

import { useState, useCallback, useEffect, useRef } from 'react';
import { CameraScanner } from '@/components/scanner/CameraScanner';
import { ManualEntry } from '@/components/scanner/ManualEntry';
import { OrderCard } from '@/components/packing/OrderCard';
import { PackConfirm } from '@/components/packing/PackConfirm';
import { useOnlineStatus } from '@/lib/hooks/useOnlineStatus';
import { useRealtimeOrders } from '@/lib/hooks/useRealtimeOrders';
import { usePackingSession } from '@/lib/hooks/usePackingSession';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { AwbLookupResult, PackOrderResult, Order } from '@/types/database.types';
import { X, ChevronRight, WifiOff, Volume2, VolumeX, AlertOctagon } from 'lucide-react';
import { getSoundEnabled, playErrorSound, playWarningSound, setSoundEnabled as setSoundPreference } from '@/lib/utils/sound';
import { vibrateError, vibrateWarning } from '@/lib/utils/vibration';
import { notifyError } from '@/lib/ui/notifications';

type ScanState = 'idle' | 'loading' | 'found' | 'not_found' | 'error';

interface ScannedOrder {
  awb: string;
  result: AwbLookupResult;
}

export default function ScanPage() {
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [scannedOrder, setScannedOrder] = useState<ScannedOrder | null>(null);
  const [notFoundAwb, setNotFoundAwb] = useState<string | null>(null);
  const [scannerPaused, setScannerPaused] = useState(false);
  const [todayCount, setTodayCount] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => getSoundEnabled());
  const [scanError, setScanError] = useState<string | null>(null);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const activeLookupRef = useRef<string | null>(null);
  const initialAwbRef = useRef<string | null>(null);

  const isOnline = useOnlineStatus();
  const { session, startSession, endSession, loading: sessionLoading } = usePackingSession(userId);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabaseClient();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    supabase
      .from('packing_events')
      .select('id', { count: 'exact' })
      .eq('packed_by', userId)
      .gte('packed_at', today.toISOString())
      .then(({ count }) => setTodayCount(count || 0));
  }, [userId]);

  useRealtimeOrders({
    onOrderUpdate: useCallback(
      (payload: Record<string, unknown>) => {
        const newRow = payload.new as Order;
        if (
          scannedOrder &&
          newRow.amazon_order_id === scannedOrder.result.amazon_order_id
        ) {
          setScannedOrder((prev) =>
            prev
              ? {
                  ...prev,
                  result: {
                    ...prev.result,
                    status: newRow.status,
                    packed_at: newRow.packed_at || undefined,
                  },
                }
              : prev
          );
        }
      },
      [scannedOrder]
    ),
  });

  const lookupAwb = useCallback(
    async (awb: string) => {
      if (!isOnline) {
        return;
      }

      const normalizedAwb = awb.trim();
      if (!normalizedAwb || activeLookupRef.current) return;
      activeLookupRef.current = normalizedAwb;

      setScanState('loading');
      setScannerPaused(true);
      setScannedOrder(null);
      setNotFoundAwb(null);
      setScanError(null);
      setAutoAdvance(false);

      try {
        const response = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ awb: normalizedAwb }),
        });
        const payload = await response.json() as AwbLookupResult & { error?: string };

        if (!response.ok) {
          setScanState('error');
          setScanError(payload.error || 'Shipment lookup failed. Try again.');
          playErrorSound();
          vibrateError();
          setScannerPaused(false);
          return;
        }

        const result = payload as AwbLookupResult;

        if (!result.found) {
          setScanState('not_found');
          setNotFoundAwb(normalizedAwb);
          playErrorSound();
          vibrateError();
          return;
        }

        if (result.status === 'CANCELLED') {
          playWarningSound();
          vibrateWarning();
        }

        setScanState('found');
        setScannedOrder({ awb: normalizedAwb, result });
      } catch {
        setScanState('error');
        setScanError('Network error while looking up that barcode. Try again.');
        playErrorSound();
        vibrateError();
      } finally {
        activeLookupRef.current = null;
      }
    },
    [isOnline]
  );

  useEffect(() => {
    const queryAwb = new URLSearchParams(window.location.search).get('awb')?.trim() || null;
    if (queryAwb && queryAwb !== initialAwbRef.current) {
      initialAwbRef.current = queryAwb;
      void lookupAwb(queryAwb);
    }
  }, [lookupAwb]);

  const handleActionComplete = useCallback(
    (action: 'CHECKING' | 'PACKED', result: PackOrderResult) => {
      if (action === 'PACKED') {
        setTodayCount((c) => c + 1);
        setAutoAdvance(true);
        setScannedOrder((prev) =>
          prev
            ? {
                ...prev,
                result: { ...prev.result, status: 'PACKED', packed_at: result.packed_at },
              }
            : prev
        );
      } else {
        setScannedOrder((prev) =>
          prev
            ? {
                ...prev,
                result: { ...prev.result, status: 'CHECKING' },
              }
            : prev
        );
      }
    },
    []
  );

  const handleNext = useCallback(() => {
    setScanState('idle');
    setScannerPaused(false);
    setScannedOrder(null);
    setNotFoundAwb(null);
    setScanError(null);
    setAutoAdvance(false);
  }, []);

  useEffect(() => {
    if (!autoAdvance) return;
    const timer = window.setTimeout(handleNext, 700);
    return () => window.clearTimeout(timer);
  }, [autoAdvance, handleNext]);

  return (
    <div className="scan-page" id="scan-page">
      {/* Header Metrics */}
      <div className="row row--between">
        <div>
          <div className="text-xs text-muted font-semibold" style={{ textTransform: 'uppercase' }}>
            Packages Processed Today
          </div>
          <div className="text-3xl font-extrabold" aria-label={`${todayCount} packages processed today`}>
            {todayCount}
          </div>
        </div>

        <div className="row" style={{ gap: 12 }}>
          {session && (
            <div className="text-xs text-muted text-right">
              <div>Session active</div>
              <div className="font-mono font-bold text-secondary">{session.orders_packed} processed</div>
            </div>
          )}
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => {
              const next = !soundEnabled;
              setSoundPreference(next);
              setSoundEnabled(next);
            }}
            title="Toggle audio feedback"
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
        </div>
      </div>

      {session ? (
        <div className="card card--elevated row row--between" style={{ gap: 12 }}>
          <div className="text-sm"><strong>SESSION ACTIVE</strong><div className="text-xs text-muted">#{session.id.slice(0, 8)} · {session.orders_packed} packages · {session.units_packed || 0} units</div></div>
          <button className="btn btn--ghost btn--sm" onClick={() => endSession()}>END SESSION</button>
        </div>
      ) : (
        <button className="btn btn--primary btn--full btn--lg" onClick={() => startSession()} disabled={sessionLoading || !userId || !isOnline}>
          {sessionLoading ? 'STARTING SESSION…' : 'START PACKING'}
        </button>
      )}

      {/* Offline Guard Banner */}
      {!isOnline && (
        <div className="card card--warning row" style={{ gap: 10 }}>
          <WifiOff size={18} color="var(--color-warning)" />
          <div>
            <div className="font-semibold text-warning" style={{ fontSize: 14 }}>
              Offline — Operational Actions Blocked
            </div>
            <div className="text-xs text-muted">
              Server verification required to prevent duplicate packing
            </div>
          </div>
        </div>
      )}

      {/* Camera scanner */}
      {!scannedOrder && scanState !== 'not_found' && scanState !== 'error' && (
        <>
          <CameraScanner
            onScan={lookupAwb}
            onError={notifyError}
            disabled={scannerPaused || !isOnline || scanState === 'loading'}
            continuous={false}
          />

          {scanState === 'loading' && (
            <div className="card text-center p-4">
              <div className="spinner" style={{ margin: '0 auto 8px' }} />
              <div className="text-sm text-secondary">Looking up AWB shipment…</div>
            </div>
          )}
        </>
      )}

      {/* Not Found Screen */}
      {scanState === 'not_found' && (
        <div className="card card--error stack fade-in p-4" role="alert">
          <div className="row" style={{ gap: 10 }}>
            <AlertOctagon size={24} color="var(--color-error)" />
            <div>
              <h2 className="text-lg font-bold text-error">BARCODE NOT FOUND</h2>
              <p className="text-sm text-muted">
                No shipment matches AWB: <strong className="font-mono text-primary">{notFoundAwb}</strong>
              </p>
            </div>
          </div>
          <div className="row mt-2" style={{ gap: 8 }}>
            <button className="btn btn--primary btn--full btn--lg" onClick={handleNext}>
              TRY SCANNING AGAIN <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}

      {scanState === 'error' && (
        <div className="card card--error stack stack--sm fade-in" role="alert">
          <div className="font-bold text-error">LOOKUP FAILED</div>
          <div className="text-sm text-muted">{scanError || 'The shipment could not be looked up.'}</div>
          <button className="btn btn--primary btn--full" onClick={handleNext}>TRY AGAIN</button>
        </div>
      )}

      {/* Manual Entry Fallback */}
      {!scannedOrder && (
        <div>
          <div className="text-xs text-muted mb-2" style={{ textTransform: 'uppercase' }}>
            Manual AWB Entry
          </div>
          <ManualEntry
            onScan={lookupAwb}
            disabled={!isOnline || scanState === 'loading'}
            placeholder="Enter AWB number (e.g. 371317811994)…"
          />
        </div>
      )}

      {/* Order Found — Visual Verification & Action Screen */}
      {scannedOrder && scanState === 'found' && (
        <div className="stack fade-in">
          <div className="row row--between">
            <span className="text-xs text-muted font-semibold" style={{ textTransform: 'uppercase' }}>
              Physical Verification Active
            </span>
            <button className="btn btn--ghost btn--sm" onClick={handleNext} aria-label="Clear and scan next">
              <X size={14} /> Clear
            </button>
          </div>

          {/* Primary Visual Verification Card */}
          <OrderCard order={scannedOrder.result} awb={scannedOrder.awb} />

          {/* Two Primary Action Buttons */}
          <PackConfirm
            order={scannedOrder.result}
            sessionId={session?.id}
            awbScanned={scannedOrder.awb}
            onActionComplete={handleActionComplete}
            onError={notifyError}
            disabled={!isOnline || !session}
          />

          {autoAdvance && (
            <div className="card card--success text-center font-bold" role="status">
              PACKED ✓ — preparing the next scan…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
