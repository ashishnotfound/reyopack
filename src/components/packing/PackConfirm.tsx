'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckSquare, ExternalLink, Loader2, PackageCheck } from 'lucide-react';
import { playErrorSound, playSuccessSound, playWarningSound } from '@/lib/utils/sound';
import { vibrateError, vibrateSuccess, vibrateWarning } from '@/lib/utils/vibration';
import type { AwbLookupResult, PackOrderResult } from '@/types/database.types';

interface PackConfirmProps {
  order: AwbLookupResult;
  sessionId?: string;
  awbScanned?: string;
  onActionComplete: (action: 'CHECKING' | 'PACKED', result: PackOrderResult) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

export function PackConfirm({ order, sessionId, awbScanned, onActionComplete, onError, disabled = false }: PackConfirmProps) {
  const [checking, setChecking] = useState(false);
  const [packing, setPacking] = useState(false);
  const [labelLoading, setLabelLoading] = useState(false);
  const [labelUrl, setLabelUrl] = useState<string | null>(order.label_url || null);
  const idempotencyKey = useRef<string | null>(null);
  const orderKey = `${order.amazon_order_id}:${sessionId || 'no-session'}:${awbScanned || 'no-awb'}`;
  const lastOrderKey = useRef(orderKey);

  useEffect(() => {
    if (lastOrderKey.current !== orderKey) {
      idempotencyKey.current = null;
      lastOrderKey.current = orderKey;
      setLabelUrl(order.label_url || null);
    }
  }, [order.label_url, orderKey]);

  const isBlocked = order.status === 'CANCELLED' || order.status === 'PACKED' || order.status === 'SHIPPED';

  const submitAction = useCallback(async (action: 'CHECKING' | 'PACKED') => {
    if (checking || packing || disabled || isBlocked || !order.amazon_order_id) return;
    if (action === 'CHECKING') setChecking(true);
    else setPacking(true);

    try {
      if (action === 'PACKED' && !idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
      const response = await fetch('/api/packing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          amazon_order_id: order.amazon_order_id,
          session_id: sessionId || null,
          awb_scanned: awbScanned || null,
          device_info: navigator.userAgent,
          idempotency_key: action === 'PACKED' ? idempotencyKey.current : null,
        }),
      });
      const result = await response.json() as PackOrderResult & { error?: string };

      if (result.success) {
        playSuccessSound();
        vibrateSuccess();
        onActionComplete(action, result);
        return;
      }

      if (result.code === 'ALREADY_PACKED' || result.code === 'ALREADY_PROCESSED') {
        playWarningSound();
        vibrateWarning();
        onError(result.message || 'ALREADY PACKED — another device recorded this package.');
      } else if (result.code === 'ORDER_CANCELLED') {
        playErrorSound();
        vibrateError();
        onError('ORDER CANCELLED — DO NOT PACK');
      } else {
        playErrorSound();
        vibrateError();
        onError(result.error || result.message || 'The server rejected this operational action.');
      }
    } catch (error) {
      playErrorSound();
      vibrateError();
      onError(`Network error: ${(error as Error).message}`);
    } finally {
      setChecking(false);
      setPacking(false);
    }
  }, [awbScanned, checking, disabled, isBlocked, onActionComplete, onError, order.amazon_order_id, packing, sessionId]);

  const handleFetchLabel = useCallback(async () => {
    if (!order.amazon_order_id || labelLoading) return;
    setLabelLoading(true);
    try {
      const response = await fetch('/api/shipping-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amazon_order_id: order.amazon_order_id }),
      });
      const data = await response.json() as { label_url?: string; error?: string };
      if (!response.ok) onError(data.error || 'Amazon shipping document is unavailable.');
      else if (data.label_url) {
        setLabelUrl(data.label_url);
        window.open(data.label_url, '_blank', 'noopener');
      } else onError('Amazon has not provided a shipping document for this shipment.');
    } catch {
      onError('Shipping document request failed.');
    } finally {
      setLabelLoading(false);
    }
  }, [labelLoading, onError, order.amazon_order_id]);

  return (
    <div className="stack stack--sm">
      <button className="btn btn--ghost btn--full" onClick={labelUrl ? () => window.open(labelUrl, '_blank', 'noopener') : handleFetchLabel} disabled={labelLoading} aria-label="View shipping document" id="btn-view-label">
        {labelLoading ? <Loader2 size={16} className="spin" /> : <ExternalLink size={16} />}
        {labelUrl ? 'VIEW SHIPPING DOCUMENT' : 'FETCH SHIPPING DOCUMENT'}
      </button>

      <div className="row" style={{ gap: 12 }}>
        <button className="btn btn--ghost btn--xl flex-1" style={{ borderColor: 'var(--color-info)', color: 'var(--color-info-text)', background: 'var(--color-info-bg)', fontWeight: 800 }} onClick={() => submitAction('CHECKING')} disabled={checking || packing || disabled || isBlocked} aria-label="Record package checking verification" id="btn-action-checking">
          {checking ? <Loader2 size={20} className="spin" /> : <><CheckSquare size={20} /> CHECKING</>}
        </button>
        <button className="btn btn--success btn--xl flex-1" style={{ fontWeight: 800 }} onClick={() => submitAction('PACKED')} disabled={checking || packing || disabled || isBlocked} aria-label="Record package packed" id="btn-action-packed">
          {packing ? <Loader2 size={20} className="spin" /> : <><PackageCheck size={20} /> PACKED</>}
        </button>
      </div>

      {isBlocked && order.status === 'CANCELLED' && <p className="text-sm text-error text-center font-bold">⚠ ORDER CANCELLED BY AMAZON — DO NOT PACK</p>}
      {isBlocked && order.status !== 'CANCELLED' && <p className="text-sm text-muted text-center font-semibold">✓ ALREADY PACKED — server confirmed</p>}
    </div>
  );
}
