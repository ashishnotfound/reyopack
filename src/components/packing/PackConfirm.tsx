'use client';
// src/components/packing/PackConfirm.tsx
// Two primary action buttons: CHECKING & SHIPPED BY MYSELF
// Implements server-validated atomic state transitions

import { useState, useCallback } from 'react';
import { CheckSquare, Send, Loader2, ExternalLink } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { playSuccessSound, playErrorSound, playWarningSound } from '@/lib/utils/sound';
import { vibrateSuccess, vibrateError, vibrateWarning } from '@/lib/utils/vibration';
import type { AwbLookupResult, PackOrderResult } from '@/types/database.types';

interface PackConfirmProps {
  order: AwbLookupResult;
  sessionId?: string;
  awbScanned?: string;
  onActionComplete: (action: 'CHECKING' | 'SHIPPED_BY_MYSELF', result: PackOrderResult) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

export function PackConfirm({
  order,
  sessionId,
  awbScanned,
  onActionComplete,
  onError,
  disabled = false,
}: PackConfirmProps) {
  const [checking, setChecking] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [labelLoading, setLabelLoading] = useState(false);
  const [labelUrl, setLabelUrl] = useState<string | null>(order.label_url || null);

  const isBlocked = order.status === 'CANCELLED' || order.status === 'PACKED' || order.status === 'SHIPPED';

  // Action 1: CHECKING
  const handleChecking = useCallback(async () => {
    if (checking || shipping || disabled || isBlocked) return;
    if (!order.amazon_order_id) return;

    setChecking(true);

    try {
      const supabase = getSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        onError('Authentication session expired.');
        return;
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/check-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          amazon_order_id: order.amazon_order_id,
          session_id: sessionId || null,
          awb_scanned: awbScanned || null,
          device_info: navigator.userAgent,
        }),
      });

      const result: PackOrderResult = await res.json();

      if (result.success) {
        playSuccessSound();
        vibrateSuccess();
        onActionComplete('CHECKING', result);
      } else {
        playErrorSound();
        vibrateError();
        onError(result.message || 'Failed to record checking state');
      }
    } catch (err) {
      playErrorSound();
      vibrateError();
      onError(`Network error: ${(err as Error).message}`);
    } finally {
      setChecking(false);
    }
  }, [checking, shipping, disabled, isBlocked, order.amazon_order_id, sessionId, awbScanned, onActionComplete, onError]);

  // Action 2: SHIPPED BY MYSELF
  const handleShippedByMyself = useCallback(async () => {
    if (checking || shipping || disabled || isBlocked) return;
    if (!order.amazon_order_id) return;

    setShipping(true);

    try {
      const supabase = getSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        onError('Authentication session expired.');
        return;
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/ship-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          amazon_order_id: order.amazon_order_id,
          session_id: sessionId || null,
          awb_scanned: awbScanned || null,
          device_info: navigator.userAgent,
        }),
      });

      const result: PackOrderResult = await res.json();

      if (result.success) {
        playSuccessSound();
        vibrateSuccess();
        onActionComplete('SHIPPED_BY_MYSELF', result);
      } else if (result.code === 'ALREADY_PROCESSED') {
        playWarningSound();
        vibrateWarning();
        onError(`Already processed${result.packed_at ? ` at ${new Date(result.packed_at).toLocaleTimeString('en-IN')}` : ''}`);
      } else if (result.code === 'ORDER_CANCELLED') {
        playErrorSound();
        vibrateError();
        onError('Order is cancelled — action blocked');
      } else {
        playErrorSound();
        vibrateError();
        onError(result.message || 'Fulfillment recording failed');
      }
    } catch (err) {
      playErrorSound();
      vibrateError();
      onError(`Network error: ${(err as Error).message}`);
    } finally {
      setShipping(false);
    }
  }, [checking, shipping, disabled, isBlocked, order.amazon_order_id, sessionId, awbScanned, onActionComplete, onError]);

  const handleFetchLabel = useCallback(async () => {
    if (!order.amazon_order_id || labelLoading) return;
    setLabelLoading(true);

    try {
      const supabase = getSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/get-shipping-label`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ amazon_order_id: order.amazon_order_id }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.label_url) {
          setLabelUrl(data.label_url);
          window.open(data.label_url, '_blank', 'noopener');
        } else {
          onError('Label not available from Amazon');
        }
      } else {
        onError('Could not fetch shipping label');
      }
    } catch {
      onError('Label fetch failed');
    } finally {
      setLabelLoading(false);
    }
  }, [order.amazon_order_id, labelLoading, onError]);

  return (
    <div className="stack stack--sm">
      {/* View Shipping Label */}
      <button
        className="btn btn--ghost btn--full"
        onClick={labelUrl ? () => window.open(labelUrl, '_blank', 'noopener') : handleFetchLabel}
        disabled={labelLoading}
        aria-label="View shipping label"
        id="btn-view-label"
      >
        {labelLoading ? <Loader2 size={16} className="spin" /> : <ExternalLink size={16} />}
        {labelUrl ? 'View Shipping Label' : 'Fetch & View Shipping Label'}
      </button>

      {/* TWO PRIMARY ACTION BUTTONS */}
      <div className="row" style={{ gap: 12 }}>
        {/* BUTTON 1: CHECKING */}
        <button
          className="btn btn--ghost btn--xl flex-1"
          style={{
            borderColor: 'var(--color-info)',
            color: 'var(--color-info-text)',
            background: 'var(--color-info-bg)',
            fontWeight: 800,
          }}
          onClick={handleChecking}
          disabled={checking || shipping || disabled || isBlocked}
          aria-label="Record package checking verification"
          id="btn-action-checking"
        >
          {checking ? (
            <Loader2 size={20} className="spin" />
          ) : (
            <>
              <CheckSquare size={20} /> CHECKING
            </>
          )}
        </button>

        {/* BUTTON 2: SHIPPED BY MYSELF */}
        <button
          className="btn btn--success btn--xl flex-1"
          style={{ fontWeight: 800 }}
          onClick={handleShippedByMyself}
          disabled={checking || shipping || disabled || isBlocked}
          aria-label="Record package shipped by myself"
          id="btn-action-shipped-by-myself"
        >
          {shipping ? (
            <Loader2 size={20} className="spin" />
          ) : (
            <>
              <Send size={20} /> SHIPPED BY MYSELF
            </>
          )}
        </button>
      </div>

      {isBlocked && order.status === 'CANCELLED' && (
        <p className="text-sm text-error text-center font-bold">
          ⚠ ORDER CANCELLED BY AMAZON — DO NOT PACK
        </p>
      )}

      {isBlocked && order.status !== 'CANCELLED' && (
        <p className="text-sm text-muted text-center font-semibold">
          ✓ Order already processed
        </p>
      )}
    </div>
  );
}
