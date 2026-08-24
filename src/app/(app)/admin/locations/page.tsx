'use client';
// src/app/(app)/admin/locations/page.tsx
// Warehouse Locations Management — View and Create Bins/Shelves

import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { WarehouseLocation } from '@/types/database.types';
import { MapPin, Plus, RefreshCw } from 'lucide-react';
import { notifyError, notifySuccess } from '@/lib/ui/notifications';

export default function LocationsPage() {
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  // Form states
  const [code, setCode] = useState('');
  const [zone, setZone] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchLocations = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('warehouse_locations')
      .select('*')
      .order('code', { ascending: true });

    setLocations((data as WarehouseLocation[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchLocations();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchLocations]);

  const handleAddLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || submitting) return;

    setSubmitting(true);
    try {
      const supabase = getSupabaseClient();
      const { error } = await (
        supabase.from('warehouse_locations') as unknown as {
          insert: (data: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
        }
      ).insert({
        code: code.trim().toUpperCase(),
        zone: zone.trim().toUpperCase() || null,
        description: description.trim() || null,
        is_active: true,
      });

      if (error) throw error;

      notifySuccess('Location created');
      setCode('');
      setZone('');
      setDescription('');
      setShowAddModal(false);
      fetchLocations();
    } catch (err) {
      notifyError(`Could not add location: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="stack">
      <div className="row row--between">
        <div>
          <h1 className="text-2xl font-extrabold row" style={{ gap: 8 }}>
            <MapPin size={24} color="var(--color-info)" /> Warehouse Bins & Locations
          </h1>
          <p className="text-sm text-secondary">
            Configure storage zones, aisles, and shelf codes (e.g. A-01-03)
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn--ghost btn--sm" onClick={fetchLocations} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
          <button className="btn btn--primary btn--sm" onClick={() => setShowAddModal(true)}>
            <Plus size={16} /> Add Location
          </button>
        </div>
      </div>

      {showAddModal && (
        <div className="card card--elevated p-4 fade-in">
          <h3 className="text-lg font-bold mb-3">Add New Location</h3>
          <form onSubmit={handleAddLocation} className="stack stack--sm">
            <div className="row" style={{ gap: 12 }}>
              <div className="form-group flex-1">
                <label className="form-label" htmlFor="new-loc-code">
                  Location Code *
                </label>
                <input
                  id="new-loc-code"
                  className="form-input font-mono"
                  required
                  placeholder="e.g. A-01-03"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>

              <div className="form-group flex-1">
                <label className="form-label" htmlFor="new-loc-zone">
                  Zone
                </label>
                <input
                  id="new-loc-zone"
                  className="form-input"
                  placeholder="e.g. ZONE-A"
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="new-loc-desc">
                Description / Notes
              </label>
              <input
                id="new-loc-desc"
                className="form-input"
                placeholder="e.g. Top shelf near packing station 1"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="row mt-2" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setShowAddModal(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn--primary btn--sm"
                disabled={submitting || !code.trim()}
              >
                {submitting ? 'Saving…' : 'Save Location'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading && locations.length === 0 ? (
        <div className="card text-center p-4">
          <div className="spinner" style={{ margin: '0 auto 8px' }} />
          <div className="text-sm text-secondary">Loading locations…</div>
        </div>
      ) : locations.length === 0 ? (
        <div className="empty-state card">
          <MapPin size={48} color="var(--text-muted)" />
          <h3 className="text-lg font-bold">No Locations Created</h3>
          <p className="text-sm text-muted mt-1">
            Add warehouse locations above to start using Putaway Mode.
          </p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Zone</th>
                <th>Description</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc) => (
                <tr key={loc.id}>
                  <td className="font-mono font-bold text-sm text-primary">
                    {loc.code}
                  </td>
                  <td className="font-mono text-xs">{loc.zone || '—'}</td>
                  <td className="text-sm">{loc.description || '—'}</td>
                  <td>
                    <span className={`badge ${loc.is_active ? 'status-success' : 'status-neutral'}`}>
                      {loc.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
