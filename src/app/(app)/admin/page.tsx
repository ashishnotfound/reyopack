'use client';
// src/app/(app)/admin/page.tsx
// Main Admin Dashboard — SP-API Sync, Quick Stats, Admin Navigation

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { SyncPanel } from '@/components/admin/SyncPanel';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { SyncRun } from '@/types/database.types';
import { Shield, Tag, MapPin, Users, KeyRound } from 'lucide-react';

export default function AdminPage() {
  const [lastSyncRun, setLastSyncRun] = useState<SyncRun | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [stats, setStats] = useState({
    totalOrders: 0,
    packedToday: 0,
    activeSkus: 0,
    locations: 0,
  });

  useEffect(() => {
    const fetchStats = async () => {
      const supabase = getSupabaseClient();

      const [
        { count: totalOrders },
        { count: packedToday },
        { count: activeSkus },
        { count: locations },
      ] = await Promise.all([
        supabase.from('orders').select('*', { count: 'exact', head: true }),
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'PACKED'),
        supabase.from('skus').select('*', { count: 'exact', head: true }),
        supabase.from('warehouse_locations').select('*', { count: 'exact', head: true }),
      ]);

      setStats({
        totalOrders: totalOrders || 0,
        packedToday: packedToday || 0,
        activeSkus: activeSkus || 0,
        locations: locations || 0,
      });

      // Fetch last sync run
      supabase
        .from('sync_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(1)
        .single()
        .then(({ data }) => setLastSyncRun(data as SyncRun | null));

      // Fetch last sync time
      supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'last_sync_at')
        .single()
        .then(({ data }) => setLastSyncAt((data as unknown as { value: string } | null)?.value || null));
    };

    const timer = setTimeout(() => {
      fetchStats();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="stack">
      <div>
        <h1 className="text-2xl font-extrabold row" style={{ gap: 8 }}>
          <Shield size={24} color="var(--color-primary)" /> Admin Controls
        </h1>
        <p className="text-sm text-secondary">
          Manage SP-API sync, warehouse catalog, locations, and user authorizations
        </p>
      </div>

      {/* Overview Stats */}
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="card card--elevated flex-1 p-4" style={{ minWidth: 140 }}>
          <div className="text-xs text-muted font-semibold">TOTAL ORDERS</div>
          <div className="text-2xl font-extrabold font-mono mt-1">{stats.totalOrders}</div>
        </div>

        <div className="card card--elevated flex-1 p-4" style={{ minWidth: 140 }}>
          <div className="text-xs text-muted font-semibold">PACKED TODAY</div>
          <div className="text-2xl font-extrabold font-mono text-success mt-1">
            {stats.packedToday}
          </div>
        </div>

        <div className="card card--elevated flex-1 p-4" style={{ minWidth: 140 }}>
          <div className="text-xs text-muted font-semibold font-mono">SKUs</div>
          <div className="text-2xl font-extrabold font-mono mt-1">{stats.activeSkus}</div>
        </div>

        <div className="card card--elevated flex-1 p-4" style={{ minWidth: 140 }}>
          <div className="text-xs text-muted font-semibold">LOCATIONS</div>
          <div className="text-2xl font-extrabold font-mono mt-1">{stats.locations}</div>
        </div>
      </div>

      {/* Sync Panel */}
      <SyncPanel initialSyncRun={lastSyncRun} lastSyncAt={lastSyncAt} />

      {/* Quick Nav Cards */}
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <Link href="/admin/settings" className="card flex-1 p-4 hover-card card--info" style={{ minWidth: 200 }}>
          <div className="row">
            <KeyRound size={20} color="var(--color-primary)" />
            <div>
              <div className="font-bold text-base">SP-API Credentials</div>
              <div className="text-xs text-muted">Client ID, Secret, Refresh Token & Merchant ID</div>
            </div>
          </div>
        </Link>

        <Link href="/admin/skus" className="card flex-1 p-4 hover-card" style={{ minWidth: 200 }}>
          <div className="row">
            <Tag size={20} color="var(--color-primary)" />
            <div>
              <div className="font-bold text-base">SKU Management</div>
              <div className="text-xs text-muted">Amazon SKUs, ASINs, Barcodes</div>
            </div>
          </div>
        </Link>

        <Link href="/admin/locations" className="card flex-1 p-4 hover-card" style={{ minWidth: 200 }}>
          <div className="row">
            <MapPin size={20} color="var(--color-info)" />
            <div>
              <div className="font-bold text-base">Warehouse Bins</div>
              <div className="text-xs text-muted">Aisle, Shelf, Bin definitions</div>
            </div>
          </div>
        </Link>

        <Link href="/admin/users" className="card flex-1 p-4 hover-card" style={{ minWidth: 200 }}>
          <div className="row">
            <Users size={20} color="var(--color-pending)" />
            <div>
              <div className="font-bold text-base">User Roles</div>
              <div className="text-xs text-muted">Packer, Putaway, Admin permissions</div>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
