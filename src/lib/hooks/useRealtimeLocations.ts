'use client';
// src/lib/hooks/useRealtimeLocations.ts
// Subscribes to Supabase Realtime for SKU location mapping changes

import { useEffect, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { SkuLocationMapping } from '@/types/database.types';

interface UseRealtimeLocationsOptions {
  onLocationUpdate?: (mapping: SkuLocationMapping) => void;
  onLocationInsert?: (mapping: SkuLocationMapping) => void;
}

export function useRealtimeLocations({
  onLocationUpdate,
  onLocationInsert,
}: UseRealtimeLocationsOptions) {
  const handleUpdate = useCallback(
    (payload: { new: SkuLocationMapping }) => {
      onLocationUpdate?.(payload.new);
    },
    [onLocationUpdate]
  );

  const handleInsert = useCallback(
    (payload: { new: SkuLocationMapping }) => {
      onLocationInsert?.(payload.new);
    },
    [onLocationInsert]
  );

  useEffect(() => {
    const supabase = getSupabaseClient();

    const channel = supabase
      .channel('locations-realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sku_location_mappings' },
        (payload) => handleUpdate(payload as unknown as { new: SkuLocationMapping })
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sku_location_mappings' },
        (payload) => handleInsert(payload as unknown as { new: SkuLocationMapping })
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [handleUpdate, handleInsert]);
}
