'use client';
// src/components/putaway/PutawayCard.tsx
// STREAMLINED PUTAWAY WORKFLOW:
// SCAN SKU → PRODUCT FOUND → PUT THIS IN: B-04-12 → [ DONE ]

import { useState } from 'react';
import { MapPin, CheckCircle, Loader2, Edit3 } from 'lucide-react';
import type { WarehouseLocation, Sku } from '@/types/database.types';

interface PutawayCardProps {
  sku: Sku & {
    location_mapping?: {
      location?: WarehouseLocation | null;
      quantity?: number;
    } | null;
  };
  locations: WarehouseLocation[];
  onAssignLocation: (skuId: string, locationId: string, quantity: number) => Promise<void>;
  loading?: boolean;
}

export function PutawayCard({ sku, locations, onAssignLocation, loading = false }: PutawayCardProps) {
  const currentLocation = sku.location_mapping?.location;
  const currentQty = sku.location_mapping?.quantity ?? 0;

  const [isEditing, setIsEditing] = useState(!currentLocation);
  const [selectedLocationId, setSelectedLocationId] = useState<string>(currentLocation?.id || '');
  const [quantity, setQuantity] = useState<number>(currentQty || 1);
  const [submitting, setSubmitting] = useState(false);

  const handleQuickDone = async () => {
    if (!currentLocation || submitting) return;
    setSubmitting(true);
    try {
      await onAssignLocation(sku.id, currentLocation.id, currentQty + 1);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLocationId || submitting) return;

    setSubmitting(true);
    try {
      await onAssignLocation(sku.id, selectedLocationId, quantity);
      setIsEditing(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card fade-in stack" role="region" aria-label={`Putaway for SKU ${sku.amazon_sku}`}>
      {/* Product Found Banner */}
      <div className="row row--between">
        <div>
          <span className="badge status-success" style={{ marginBottom: 4 }}>
            PRODUCT FOUND ✓
          </span>
          <h2 className="text-xl font-bold text-primary">{sku.title || sku.amazon_sku}</h2>
          <div className="row mt-1 text-xs text-muted font-mono" style={{ gap: 12 }}>
            <span>SKU: {sku.amazon_sku}</span>
            {sku.asin && <span>ASIN: {sku.asin}</span>}
          </div>
        </div>
      </div>

      {/* Streamlined "PUT THIS IN" Target Box */}
      {currentLocation && !isEditing && (
        <div className="card card--info p-4 stack text-center" style={{ border: '2px solid var(--color-info-border)' }}>
          <div className="text-xs text-muted font-extrabold" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            PUT THIS IN LOCATION
          </div>
          <div className="text-4xl font-extrabold font-mono text-primary my-2 row row--center" style={{ gap: 8 }}>
            <MapPin size={32} color="var(--color-info)" />
            {currentLocation.code}
          </div>
          <div className="text-xs text-secondary">
            Current Stock at Location: <strong className="font-mono text-primary">{currentQty} units</strong>
          </div>

          <div className="row mt-3" style={{ gap: 8 }}>
            <button
              className="btn btn--success btn--xl btn--full"
              onClick={handleQuickDone}
              disabled={submitting || loading}
              id="btn-putaway-done"
            >
              {submitting ? (
                <>
                  <Loader2 size={20} className="spin" /> Updating…
                </>
              ) : (
                <>
                  <CheckCircle size={22} /> DONE — ITEM PLACED
                </>
              )}
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setIsEditing(true)}
              title="Reassign to different bin / shelf"
              aria-label="Reassign location"
            >
              <Edit3 size={16} /> Reassign
            </button>
          </div>
        </div>
      )}

      {/* Reassign / Select Location Form */}
      {(isEditing || !currentLocation) && (
        <form onSubmit={handleSubmitCustom} className="card card--elevated p-4 stack stack--sm mt-2">
          <div className="text-sm font-bold text-secondary mb-1">
            {currentLocation ? 'Reassign Warehouse Bin' : 'Assign Initial Warehouse Bin'}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor={`location-select-${sku.id}`}>
              Select Warehouse Bin / Shelf *
            </label>
            <select
              id={`location-select-${sku.id}`}
              className="form-input font-mono font-bold"
              value={selectedLocationId}
              onChange={(e) => setSelectedLocationId(e.target.value)}
              disabled={submitting || loading}
              required
            >
              <option value="">-- Select Bin / Shelf --</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.code} {loc.zone ? `(Zone ${loc.zone})` : ''} {loc.description ? `- ${loc.description}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor={`qty-input-${sku.id}`}>
              Quantity at Bin
            </label>
            <input
              id={`qty-input-${sku.id}`}
              type="number"
              min="1"
              className="form-input"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
              disabled={submitting || loading}
            />
          </div>

          <div className="row mt-2" style={{ gap: 8 }}>
            {currentLocation && (
              <button
                type="button"
                className="btn btn--ghost flex-1"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              className="btn btn--primary flex-1 btn--lg"
              disabled={!selectedLocationId || submitting || loading}
            >
              {submitting ? (
                <>
                  <Loader2 size={18} className="spin" /> Assigning…
                </>
              ) : (
                <>
                  <CheckCircle size={18} /> CONFIRM LOCATION
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
