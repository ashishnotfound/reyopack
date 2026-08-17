'use client';
// src/lib/hooks/useRealtimeOrders.ts
// Subscribes to Supabase Realtime for order state changes

import { useEffect, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';

interface UseRealtimeOrdersOptions {
  onOrderUpdate?: (payload: Record<string, unknown>) => void;
  onOrderInsert?: (payload: Record<string, unknown>) => void;
  onPackingEvent?: (payload: Record<string, unknown>) => void;
}

export function useRealtimeOrders({
  onOrderUpdate,
  onOrderInsert,
  onPackingEvent,
}: UseRealtimeOrdersOptions) {
  const handleUpdate = useCallback(
    (payload: Record<string, unknown>) => {
      onOrderUpdate?.(payload);
    },
    [onOrderUpdate]
  );

  const handleInsert = useCallback(
    (payload: Record<string, unknown>) => {
      onOrderInsert?.(payload);
    },
    [onOrderInsert]
  );

  const handlePackingEvent = useCallback(
    (payload: Record<string, unknown>) => {
      onPackingEvent?.(payload);
    },
    [onPackingEvent]
  );

  useEffect(() => {
    const supabase = getSupabaseClient();

    const channel = supabase
      .channel('orders-realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => handleUpdate(payload as unknown as Record<string, unknown>)
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => handleInsert(payload as unknown as Record<string, unknown>)
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'packing_events' },
        (payload) => handlePackingEvent(payload as unknown as Record<string, unknown>)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [handleUpdate, handleInsert, handlePackingEvent]);
}

// Hook for sync run status updates (admin panel)
export function useRealtimeSyncRuns(onUpdate: (payload: Record<string, unknown>) => void) {
  useEffect(() => {
    const supabase = getSupabaseClient();

    const channel = supabase
      .channel('sync-runs-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sync_runs' },
        (payload) => onUpdate(payload as unknown as Record<string, unknown>)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [onUpdate]);
}
