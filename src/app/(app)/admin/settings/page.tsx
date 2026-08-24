'use client';
// src/app/(app)/admin/settings/page.tsx
// SP-API Credentials & Settings Management Page
// Protected by RLS (Admin role only)

import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Lock, Save, RefreshCw, KeyRound, CheckCircle2, CircleAlert, Volume2, Vibrate } from 'lucide-react';
import { SyncPanel } from '@/components/admin/SyncPanel';
import { notifyError, notifySuccess } from '@/lib/ui/notifications';
import { getSoundEnabled, setSoundEnabled } from '@/lib/utils/sound';
import { getVibrationEnabled, setVibrationEnabled } from '@/lib/utils/vibration';

interface AmazonStatus {
  configured: boolean;
  fields: Record<string, boolean>;
  marketplaceId: string;
  region: string;
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form states (non-sensitive system parameters)
  const [marketplaceId, setMarketplaceId] = useState('A21TJRUUN4KGV');
  const [region, setRegion] = useState('eu-west-1');
  const [lookbackHours, setLookbackHours] = useState('48');
  const [amazonStatus, setAmazonStatus] = useState<AmazonStatus | null>(null);
  const [soundEnabled, setSoundPreference] = useState(() => getSoundEnabled());
  const [vibrationEnabled, setVibrationPreference] = useState(() => getVibrationEnabled());

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('system_settings')
      .select('*');

    if (data) {
      const map: Record<string, string> = {};
      data.forEach((item: { key: string; value: string }) => {
        map[item.key] = item.value;
      });

      if (map.amazon_marketplace_id) setMarketplaceId(map.amazon_marketplace_id);
      if (map.amazon_region) setRegion(map.amazon_region);
      if (map.sync_lookback_hours) setLookbackHours(map.sync_lookback_hours);
    }
    setLoading(false);
  }, []);

  const fetchAmazonStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/amazon-status', { cache: 'no-store' });
      if (response.ok) setAmazonStatus(await response.json() as AmazonStatus);
      else setAmazonStatus({ configured: false, fields: {}, marketplaceId: 'A21TJRUUN4KGV', region: 'eu-west-1' });
    } catch {
      setAmazonStatus({ configured: false, fields: {}, marketplaceId: 'A21TJRUUN4KGV', region: 'eu-west-1' });
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSettings();
      fetchAmazonStatus();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchAmazonStatus, fetchSettings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    const settingsToSave = [
      { key: 'amazon_marketplace_id', value: marketplaceId.trim(), description: 'Amazon Marketplace ID' },
      { key: 'amazon_region', value: region.trim(), description: 'Amazon SP-API Endpoint Region' },
      { key: 'sync_lookback_hours', value: lookbackHours.trim(), description: 'Hours to look back when syncing orders' },
    ];

    try {
      for (const item of settingsToSave) {
        if (!item.value) continue;
        const { error } = await (
          supabase.from('system_settings') as unknown as {
            upsert: (data: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
          }
        ).upsert({
          key: item.key,
          value: item.value,
          description: item.description,
          updated_at: new Date().toISOString(),
          updated_by: user?.id || null,
        });

        if (error) throw error;
      }

      notifySuccess('Operational settings saved');
      void fetchSettings();
    } catch (err) {
      notifyError(`Could not save settings: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="stack" id="admin-settings-page">
      <div className="row row--between">
        <div>
          <h1 className="text-2xl font-extrabold row" style={{ gap: 8 }}>
            <KeyRound size={24} color="var(--color-primary)" /> Amazon Connection
          </h1>
          <p className="text-sm text-secondary">
              Understand connection health and configure non-sensitive marketplace settings
          </p>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={fetchSettings} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="card text-center p-4">
          <div className="spinner" style={{ margin: '0 auto 8px' }} />
          <div className="text-sm text-secondary">Loading system credentials…</div>
        </div>
      ) : (
        <>
        <form onSubmit={handleSave} className="stack">
          <div className={`card ${amazonStatus?.configured ? 'card--success' : 'card--warning'} stack stack--sm`} role="status">
            <div className="row row--between">
              <div className="row" style={{ gap: 8 }}>
                {amazonStatus?.configured ? <CheckCircle2 size={20} color="var(--color-success)" /> : <CircleAlert size={20} color="var(--color-warning)" />}
                <div className="font-bold text-base">AMAZON: {amazonStatus ? (amazonStatus.configured ? 'CONNECTED' : 'NOT CONFIGURED') : 'CHECKING…'}</div>
              </div>
              <div className="text-xs font-mono">{amazonStatus?.marketplaceId || 'Amazon.in'}</div>
            </div>
            <div className="text-xs text-muted">
              {amazonStatus?.configured ? 'All required server-side connection values are present. Use SYNC NOW below to verify API health.' : 'Amazon is safe to configure, but the server-side secrets are not complete yet.'}
            </div>
            {amazonStatus && (
              <div className="setup-checklist__grid">
                {[
                  ['LWA Client ID', amazonStatus.fields.clientId],
                  ['LWA Client Secret', amazonStatus.fields.clientSecret],
                  ['SP-API Refresh Token', amazonStatus.fields.refreshToken],
                  ['Seller ID', amazonStatus.fields.sellerId],
                  ['Marketplace ID', amazonStatus.fields.marketplaceId],
                  ['Region', amazonStatus.fields.region],
                ].map(([label, ready]) => (
                  <div className="setup-checklist__row" key={String(label)}>
                    <span className="text-xs">{label}</span>
                    <span className={`text-xs ${ready ? 'text-success' : 'text-warning'}`}>{ready ? 'Configured ✓' : 'Missing'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Secure Credentials Notice */}
          <div className="card card--info p-4 stack stack--sm" role="region" aria-label="Security Architecture Notice">
            <div className="text-base font-bold row" style={{ gap: 8 }}>
              <Lock size={18} color="var(--color-primary)" /> Secure Edge Function Secrets Architecture
            </div>
            <p className="text-xs text-muted" style={{ lineHeight: 1.5 }}>
              To protect your business from credential leaks, production Amazon SP-API secrets are configured in <strong>Supabase Edge Function Secrets</strong> or the server environment. Reyo Pack only reads presence flags here; it never displays or stores the values in browser-accessible database tables.
            </p>
            <div className="text-xs font-mono bg-tertiary p-3 border-radius-sm" style={{ border: '1px solid var(--border-subtle)' }}>
              Supabase Dashboard → Project Settings → Edge Functions → Secrets:<br />
              • AMAZON_CLIENT_ID<br />
              • AMAZON_CLIENT_SECRET<br />
              • AMAZON_SP_API_REFRESH_TOKEN<br />
              • AMAZON_SELLER_ID
            </div>
          </div>

          {/* Merchant & Marketplace Section */}
          <div className="card stack">
            <div className="text-base font-bold">Seller & Marketplace Configuration</div>

            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div className="form-group flex-1" style={{ minWidth: 200 }}>
                <label className="form-label" htmlFor="amazon-marketplace-id">
                  Marketplace ID
                </label>
                <select
                  id="amazon-marketplace-id"
                  className="form-input"
                  value={marketplaceId}
                  onChange={(e) => setMarketplaceId(e.target.value)}
                >
                  <option value="A21TJRUUN4KGV">India (IN) — A21TJRUUN4KGV</option>
                  <option value="ATVPDKIKX0DER">US (NA) — ATVPDKIKX0DER</option>
                  <option value="A1F83G8C2ARO7P">UK (EU) — A1F83G8C2ARO7P</option>
                  <option value="A1PA6795UKMFR9">Germany (DE) — A1PA6795UKMFR9</option>
                  <option value="A13V1IB3VIYZZH">France (FR) — A13V1IB3VIYZZH</option>
                </select>
              </div>
            </div>

            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div className="form-group flex-1" style={{ minWidth: 200 }}>
                <label className="form-label" htmlFor="amazon-region">
                  SP-API Region Endpoint
                </label>
                <select
                  id="amazon-region"
                  className="form-input"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                >
                  <option value="eu-west-1">EU / India Endpoint (sellingpartnerapi-eu.amazon.com)</option>
                  <option value="us-east-1">North America Endpoint (sellingpartnerapi-na.amazon.com)</option>
                  <option value="us-west-2">Far East Endpoint (sellingpartnerapi-fe.amazon.com)</option>
                </select>
              </div>

              <div className="form-group flex-1" style={{ minWidth: 200 }}>
                <label className="form-label" htmlFor="sync-lookback-hours">
                  Default Sync Lookback Hours
                </label>
                <input
                  id="sync-lookback-hours"
                  type="number"
                  min="1"
                  max="168"
                  className="form-input"
                  value={lookbackHours}
                  onChange={(e) => setLookbackHours(e.target.value)}
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn--primary btn--xl btn--full"
            disabled={submitting}
            id="btn-save-credentials"
          >
            <Save size={20} />
            {submitting ? 'Saving Settings…' : 'SAVE OPERATIONAL SETTINGS'}
          </button>

          <div className="card stack stack--sm">
            <div className="text-base font-bold">Packing device preferences</div>
            <p className="text-xs text-muted">Saved on this device only. These controls never affect server authorization or packing state.</p>
            <label className="row row--between text-sm" htmlFor="setting-sound">
              <span className="row"><Volume2 size={16} /> Sound feedback</span>
              <input id="setting-sound" type="checkbox" checked={soundEnabled} onChange={(event) => { setSoundPreference(event.target.checked); setSoundEnabled(event.target.checked); }} />
            </label>
            <label className="row row--between text-sm" htmlFor="setting-vibration">
              <span className="row"><Vibrate size={16} /> Vibration feedback</span>
              <input id="setting-vibration" type="checkbox" checked={vibrationEnabled} onChange={(event) => { setVibrationPreference(event.target.checked); setVibrationEnabled(event.target.checked); }} />
            </label>
            <div className="text-xs text-muted">Scanner automatically pauses after a decode and returns to READY TO SCAN after PACKED.</div>
          </div>
        </form>
        <SyncPanel />
        </>
      )}
    </div>
  );
}
