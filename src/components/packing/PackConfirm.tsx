'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckSquare, ExternalLink, Loader2, PackageCheck } from 'lucide-react';
import { playErrorSound, playSuccessSound, playWarningSound } from '@/lib/utils/sound';
import { vibrateError, vibrateSuccess, vibrateWarning } from '@/lib/utils/vibration';
import type { AwbLookupResult, PackOrderResult } from '@/types/database.types';
import { getSupabaseClient } from '@/lib/supabase/client';
import { invokeSupabaseFunction } from '@/lib/supabase/edge';
import { normalizeBarcode } from '@/lib/domain/awb';

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
      const supabase = getSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Authentication session expired.');
      const rpc = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
      const rpcName = action === 'PACKED' ? 'atomic_pack_order' : 'atomic_check_order';
      const { data, error } = await rpc(rpcName, {
        p_amazon_order_id: order.amazon_order_id,
        p_packer_id: user.id,
        p_session_id: sessionId || null,
        p_awb_scanned: awbScanned ? normalizeBarcode(awbScanned) : null,
        p_device_info: navigator.userAgent,
        ...(action === 'PACKED' ? { p_idempotency_key: idempotencyKey.current } : {}),
      });
      if (error) throw error;
      const result = data as PackOrderResult & { error?: string };

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
      const { response, data } = await invokeSupabaseFunction<{ label_url?: string; error?: string }>('get-shipping-label', {
        method: 'POST',
        body: { amazon_order_id: order.amazon_order_id },
      });
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
