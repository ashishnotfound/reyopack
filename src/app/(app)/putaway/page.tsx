'use client';
// src/app/(app)/putaway/page.tsx
// PUTAWAY MODE — Scan SKU or product barcode → Assign to warehouse location

import { useState, useEffect, useCallback } from 'react';
import { CameraScanner } from '@/components/scanner/CameraScanner';
import { ManualEntry } from '@/components/scanner/ManualEntry';
import { PutawayCard } from '@/components/putaway/PutawayCard';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useRealtimeLocations } from '@/lib/hooks/useRealtimeLocations';
import type { Sku, WarehouseLocation, SkuLocationMapping } from '@/types/database.types';
import { Archive, History, X } from 'lucide-react';
import Link from 'next/link';
import { notifyError } from '@/lib/ui/notifications';

type SkuWithLocation = Sku & {
  location_mapping?: {
    location?: WarehouseLocation | null;
    quantity?: number;
  } | null;
};

export default function PutawayPage() {
  const [scannedSku, setScannedSku] = useState<SkuWithLocation | null>(null);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [scannerPaused, setScannerPaused] = useState(false);

  // Fetch all warehouse locations on mount
  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase
      .from('warehouse_locations')
      .select('*')
      .eq('is_active', true)
      .order('code', { ascending: true })
      .then(({ data }) => setLocations((data as WarehouseLocation[]) || []));
  }, []);

  // Listen to realtime location changes
  useRealtimeLocations({
    onLocationUpdate: useCallback((newMapping: SkuLocationMapping) => {
      if (scannedSku && scannedSku.id === newMapping.sku_id) {
        // Re-fetch or update local state
        const loc = locations.find((l) => l.id === newMapping.location_id);
        setScannedSku((prev) =>
          prev
            ? {
                ...prev,
                location_mapping: {
                  location: loc || null,
                  quantity: newMapping.quantity,
                },
              }
            : prev
        );
      }
    }, [scannedSku, locations]),
  });

  const handleScanBarcode = async (barcode: string) => {
    setLoading(true);
    setScannerPaused(true);
    const supabase = getSupabaseClient();

    try {
      // 1. Try barcode_mappings table
      const { data: mapping } = (await supabase
        .from('barcode_mappings')
        .select(`
          sku:skus(
            *,
            location_mapping:sku_location_mappings(
              quantity,
              location:warehouse_locations(*)
            )
          )
        `)
        .eq('barcode', barcode.trim())
        .single()) as unknown as { data: { sku: SkuWithLocation | null } | null };

      if (mapping?.sku) {
        setScannedSku(mapping.sku);
        setLoading(false);
        return;
      }

      // 2. Try direct amazon_sku, fnsku, or asin match
      const { data: directSku } = (await supabase
        .from('skus')
        .select(`
          *,
          location_mapping:sku_location_mappings(
            quantity,
            location:warehouse_locations(*)
          )
        `)
        .or(`amazon_sku.eq.${barcode.trim()},fnsku.eq.${barcode.trim()},asin.eq.${barcode.trim()}`)
        .single()) as unknown as { data: SkuWithLocation | null };

      if (directSku) {
        setScannedSku(directSku);
      } else {
        notifyError(`No SKU or product found for barcode: ${barcode}`);
        setScannerPaused(false);
      }
    } catch {
      notifyError('Could not look up that SKU or barcode.');
      setScannerPaused(false);
    } finally {
      setLoading(false);
    }
  };

  const handleAssignLocation = async (skuId: string, locationId: string, quantity: number) => {
    const response = await fetch('/api/putaway', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku_id: skuId, location_id: locationId, quantity, notes: 'Assigned via Putaway Mode' }),
    });
    const result = await response.json().catch(() => ({ error: 'Location assignment returned an unreadable response.' }));

    if (!response.ok || result.success === false) {
      notifyError(result.error || result.message || 'Failed to assign location.');
    } else {
      // Update local state
      const newLoc = locations.find((l) => l.id === locationId);
      setScannedSku((prev) =>
        prev
          ? {
              ...prev,
              location_mapping: {
                location: newLoc || null,
                quantity,
              },
            }
          : prev
      );
    }
  };

  return (
    <div className="stack" id="putaway-page">
      <div className="row row--between">
        <div>
          <h1 className="text-2xl font-extrabold row" style={{ gap: 8 }}>
            <Archive size={24} color="var(--color-primary)" /> Putaway Mode
          </h1>
          <p className="text-sm text-secondary">
            Scan product or SKU label → Know location → Assign bin/shelf
          </p>
        </div>
        <Link href="/putaway/history" className="btn btn--ghost btn--sm">
          <History size={14} /> History
        </Link>
      </div>

      {!scannedSku ? (
        <>
          <CameraScanner
            onScan={handleScanBarcode}
            onError={notifyError}
            disabled={scannerPaused || loading}
          />

          <div>
            <div className="text-xs text-muted mb-2" style={{ textTransform: 'uppercase' }}>
              Manual SKU / Barcode Lookup
            </div>
            <ManualEntry
              onScan={handleScanBarcode}
              placeholder="Scan or type Amazon SKU, FNSKU, or EAN…"
              disabled={loading}
            />
          </div>
        </>
      ) : (
        <div className="stack fade-in">
          <div className="row row--between">
            <span className="text-xs text-muted" style={{ textTransform: 'uppercase' }}>
              Putaway Active
            </span>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setScannedSku(null);
                setScannerPaused(false);
              }}
            >
              <X size={14} /> Scan Next Item
            </button>
          </div>

          <PutawayCard
            sku={scannedSku}
            locations={locations}
            onAssignLocation={handleAssignLocation}
            loading={loading}
          />
        </div>
      )}
    </div>
  );
}
