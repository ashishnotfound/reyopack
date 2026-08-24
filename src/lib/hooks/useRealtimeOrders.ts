'use client';
// src/lib/hooks/useRealtimeOrders.ts
// Subscribes to Supabase Realtime for order state changes

import { useEffect, useRef } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/config';

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
  const handlersRef = useRef({ onOrderUpdate, onOrderInsert, onPackingEvent });

  useEffect(() => {
    handlersRef.current = { onOrderUpdate, onOrderInsert, onPackingEvent };
  }, [onOrderUpdate, onOrderInsert, onPackingEvent]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const supabase = getSupabaseClient();

    const channel = supabase
      .channel('orders-realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => handlersRef.current.onOrderUpdate?.(payload as unknown as Record<string, unknown>)
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => handlersRef.current.onOrderInsert?.(payload as unknown as Record<string, unknown>)
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'packing_events' },
        (payload) => handlersRef.current.onPackingEvent?.(payload as unknown as Record<string, unknown>)
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);
}

// Hook for sync run status updates (admin panel)
export function useRealtimeSyncRuns(onUpdate: (payload: Record<string, unknown>) => void) {
  const onUpdateRef = useRef(onUpdate);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const supabase = getSupabaseClient();

    const channel = supabase
      .channel('sync-runs-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sync_runs' },
        (payload) => onUpdateRef.current(payload as unknown as Record<string, unknown>)
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);
}
