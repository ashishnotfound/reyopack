'use client';
// src/app/(app)/scan/page.tsx
// PRIMARY PACKING PAGE — Scan AWB → Visual Verification → Action (CHECKING / SHIPPED BY MYSELF) → Record → Next

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'react-hot-toast';
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
import { playErrorSound, playWarningSound } from '@/lib/utils/sound';
import { vibrateError, vibrateWarning } from '@/lib/utils/vibration';

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
  const [soundEnabled, setSoundEnabled] = useState(true);

  const isOnline = useOnlineStatus();
  const { session } = usePackingSession(userId);

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
  }, [userId, scannedOrder]);

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
        toast.error('Cannot scan while offline');
        return;
      }

      setScanState('loading');
      setScannerPaused(true);
      setScannedOrder(null);
      setNotFoundAwb(null);

      try {
        const supabase = getSupabaseClient();
        const { data, error } = await (
          supabase.rpc as unknown as (
            fn: string,
            args: { p_awb: string }
          ) => Promise<{ data: AwbLookupResult; error: { message: string } | null }>
        )('lookup_order_by_awb', {
          p_awb: awb.trim(),
        });

        if (error) {
          setScanState('error');
          toast.error(`Lookup failed: ${error.message}`);
          setScannerPaused(false);
          return;
        }

        const result = data as AwbLookupResult;

        if (!result.found) {
          setScanState('not_found');
          setNotFoundAwb(awb);
          playErrorSound();
          vibrateError();
          return;
        }

        if (result.status === 'CANCELLED') {
          playWarningSound();
          vibrateWarning();
        }

        setScanState('found');
        setScannedOrder({ awb, result });
      } catch (err) {
        setScanState('error');
        playErrorSound();
        vibrateError();
        toast.error(`Error: ${(err as Error).message}`);
        setTimeout(() => {
          setScanState('idle');
          setScannerPaused(false);
        }, 2000);
      }
    },
    [isOnline]
  );

  const handleActionComplete = useCallback(
    (action: 'CHECKING' | 'SHIPPED_BY_MYSELF', result: PackOrderResult) => {
      if (action === 'SHIPPED_BY_MYSELF') {
        setTodayCount((c) => c + 1);
        toast.success('✓ Order Shipped & Event Recorded!', { duration: 2000 });
        setScannedOrder((prev) =>
          prev
            ? {
                ...prev,
                result: { ...prev.result, status: 'PACKED', packed_at: result.packed_at },
              }
            : prev
        );
      } else {
        toast.success('✓ Checking status recorded', { duration: 1500 });
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
  }, []);

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
            onClick={() => setSoundEnabled(!soundEnabled)}
            title="Toggle audio feedback"
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
        </div>
      </div>

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
      {!scannedOrder && scanState !== 'not_found' && (
        <>
          <CameraScanner
            onScan={lookupAwb}
            onError={(err) => toast.error(err)}
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
            onError={(msg) => toast.error(msg)}
            disabled={!isOnline}
          />

          {/* Next Button after processing */}
          {(scannedOrder.result.status === 'PACKED' || scannedOrder.result.status === 'SHIPPED') && (
            <button
              className="btn btn--primary btn--full btn--lg mt-2"
              onClick={handleNext}
              aria-label="Scan next package"
              id="btn-next-package"
            >
              NEXT PACKAGE <ChevronRight size={20} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
