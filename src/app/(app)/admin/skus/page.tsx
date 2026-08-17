'use client';
// src/app/(app)/admin/skus/page.tsx
// SKU Catalog Management — View, Add, and Edit Amazon SKUs and Barcode Mappings

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Sku, BarcodeMapping } from '@/types/database.types';
import { Tag, Plus, RefreshCw } from 'lucide-react';

type SkuWithBarcodes = Sku & {
  barcode_mappings?: BarcodeMapping[];
};

export default function SkusPage() {
  const [skus, setSkus] = useState<SkuWithBarcodes[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  // Form states
  const [amazonSku, setAmazonSku] = useState('');
  const [asin, setAsin] = useState('');
  const [title, setTitle] = useState('');
  const [barcode, setBarcode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchSkus = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('skus')
      .select('*, barcode_mappings(*)')
      .order('created_at', { ascending: false });

    setSkus((data as SkuWithBarcodes[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSkus();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchSkus]);

  const handleAddSku = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amazonSku.trim() || submitting) return;

    setSubmitting(true);
    const supabase = getSupabaseClient();

    try {
      // 1. Insert SKU
      const { data: newSku, error: skuError } = await (
        supabase.from('skus') as unknown as {
          insert: (data: Record<string, unknown>) => {
            select: () => {
              single: () => Promise<{ data: Sku | null; error: { message: string } | null }>;
            };
          };
        }
      )
        .insert({
          amazon_sku: amazonSku.trim(),
          asin: asin.trim() || null,
          title: title.trim() || null,
        })
        .select()
        .single();

      if (skuError) throw new Error(skuError.message);

      // 2. Insert barcode mapping if provided
      if (barcode.trim() && newSku) {
        const { error: bcError } = await (
          supabase.from('barcode_mappings') as unknown as {
            insert: (data: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
          }
        ).insert({
          sku_id: (newSku as unknown as { id: string }).id,
          barcode: barcode.trim(),
          barcode_type: 'EAN13',
          is_primary: true,
        });

        if (bcError) toast.error(`SKU created, but barcode failed: ${bcError.message}`);
      }

      toast.success('✓ SKU created successfully');
      setAmazonSku('');
      setAsin('');
      setTitle('');
      setBarcode('');
      setShowAddModal(false);
      fetchSkus();
    } catch (err) {
      toast.error(`Error adding SKU: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const skusWithoutImage = skus.filter((s) => !s.product_id);

  return (
    <div className="stack">
      <div className="row row--between">
        <div>
          <h1 className="text-2xl font-extrabold row" style={{ gap: 8 }}>
            <Tag size={24} color="var(--color-primary)" /> SKU Catalog
          </h1>
          <p className="text-sm text-secondary">
            Manage Amazon Seller SKUs, ASINs, product images, and physical barcode mappings
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn--ghost btn--sm" onClick={fetchSkus} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
          <button className="btn btn--primary btn--sm" onClick={() => setShowAddModal(true)}>
            <Plus size={16} /> Add SKU
          </button>
        </div>
      </div>

      {/* Missing Image Warning Banner */}
      {skusWithoutImage.length > 0 && (
        <div className="card card--warning p-4 row" style={{ gap: 12 }} role="alert">
          <div>
            <div className="font-bold text-sm text-warning">
              ⚠ {skusWithoutImage.length} SKU{skusWithoutImage.length === 1 ? '' : 's'} missing primary product image
            </div>
            <div className="text-xs text-muted mt-1">
              Add catalog images to these SKUs to enable visual verification for packers.
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="card card--elevated p-4 fade-in">
          <h3 className="text-lg font-bold mb-3">Add New SKU</h3>
          <form onSubmit={handleAddSku} className="stack stack--sm">
            <div className="form-group">
              <label className="form-label" htmlFor="new-amazon-sku">
                Amazon Seller SKU *
              </label>
              <input
                id="new-amazon-sku"
                className="form-input"
                required
                placeholder="e.g. REYO-SHIRT-BLK-M"
                value={amazonSku}
                onChange={(e) => setAmazonSku(e.target.value)}
              />
            </div>

            <div className="row" style={{ gap: 12 }}>
              <div className="form-group flex-1">
                <label className="form-label" htmlFor="new-asin">
                  ASIN
                </label>
                <input
                  id="new-asin"
                  className="form-input"
                  placeholder="B0XXXXXXXX"
                  value={asin}
                  onChange={(e) => setAsin(e.target.value)}
                />
              </div>

              <div className="form-group flex-1">
                <label className="form-label" htmlFor="new-barcode">
                  EAN / Barcode
                </label>
                <input
                  id="new-barcode"
                  className="form-input"
                  placeholder="890XXXXXXXXXX"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="new-title">
                Product Title
              </label>
              <input
                id="new-title"
                className="form-input"
                placeholder="Product description…"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
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
                disabled={submitting || !amazonSku.trim()}
              >
                {submitting ? 'Saving…' : 'Save SKU'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading && skus.length === 0 ? (
        <div className="card text-center p-4">
          <div className="spinner" style={{ margin: '0 auto 8px' }} />
          <div className="text-sm text-secondary">Loading SKU catalog…</div>
        </div>
      ) : skus.length === 0 ? (
        <div className="empty-state card">
          <Tag size={48} color="var(--text-muted)" />
          <h3 className="text-lg font-bold">No SKUs Configured</h3>
          <p className="text-sm text-muted mt-1">
            SKUs are automatically populated during Amazon SP-API sync or can be added manually above.
          </p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Amazon SKU</th>
                <th>ASIN</th>
                <th>Title</th>
                <th>Barcodes Mapped</th>
              </tr>
            </thead>
            <tbody>
              {skus.map((sku) => (
                <tr key={sku.id}>
                  <td className="font-mono font-bold text-sm text-primary">
                    {sku.amazon_sku}
                  </td>
                  <td className="font-mono text-xs text-muted">
                    {sku.asin || '—'}
                  </td>
                  <td className="text-sm">{sku.title || '—'}</td>
                  <td className="font-mono text-xs">
                    {sku.barcode_mappings && sku.barcode_mappings.length > 0 ? (
                      sku.barcode_mappings.map((b) => b.barcode).join(', ')
                    ) : (
                      <span className="text-muted">None</span>
                    )}
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
