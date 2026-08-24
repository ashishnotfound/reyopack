'use client';
// src/lib/hooks/useRealtimeLocations.ts
// Subscribes to Supabase Realtime for SKU location mapping changes

import { useEffect, useRef } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/config';
import type { SkuLocationMapping } from '@/types/database.types';

interface UseRealtimeLocationsOptions {
  onLocationUpdate?: (mapping: SkuLocationMapping) => void;
  onLocationInsert?: (mapping: SkuLocationMapping) => void;
}

export function useRealtimeLocations({
  onLocationUpdate,
  onLocationInsert,
}: UseRealtimeLocationsOptions) {
  const handlersRef = useRef({ onLocationUpdate, onLocationInsert });

  useEffect(() => {
    handlersRef.current = { onLocationUpdate, onLocationInsert };
  }, [onLocationUpdate, onLocationInsert]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const supabase = getSupabaseClient();

    const channel = supabase
      .channel('locations-realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sku_location_mappings' },
        (payload) => handlersRef.current.onLocationUpdate?.((payload as unknown as { new: SkuLocationMapping }).new)
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sku_location_mappings' },
        (payload) => handlersRef.current.onLocationInsert?.((payload as unknown as { new: SkuLocationMapping }).new)
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);
}
