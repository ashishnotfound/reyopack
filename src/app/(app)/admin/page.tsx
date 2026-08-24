'use client';
// src/app/(app)/admin/page.tsx
// Main Admin Dashboard — SP-API Sync, Quick Stats, Admin Navigation

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { SyncPanel } from '@/components/admin/SyncPanel';
import { SetupChecklist } from '@/components/admin/SetupChecklist';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { SyncRun } from '@/types/database.types';
import { Shield, Tag, MapPin, Users, KeyRound, History, PackageSearch, Archive, Ban, Settings2, ClipboardList } from 'lucide-react';

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

      <SetupChecklist />

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
      <div className="admin-link-grid">
        <Link href="/admin/amazon" className="card p-4 hover-card card--info">
          <div className="row"><KeyRound size={20} color="var(--color-primary)" /><div>
              <div className="font-bold text-base">Amazon</div>
              <div className="text-xs text-muted">Marketplace and sync settings; secrets stay in Supabase</div>
            </div></div>
        </Link>

        <Link href="/queue" className="card p-4 hover-card"><div className="row"><PackageSearch size={20} color="var(--color-primary)" /><div><div className="font-bold text-base">Orders</div><div className="text-xs text-muted">Current packing queue</div></div></div></Link>
        <Link href="/history" className="card p-4 hover-card"><div className="row"><History size={20} color="var(--color-primary)" /><div><div className="font-bold text-base">Packing History</div><div className="text-xs text-muted">Permanent packing events</div></div></div></Link>
        <Link href="/admin/sessions" className="card p-4 hover-card"><div className="row"><ClipboardList size={20} color="var(--color-primary)" /><div><div className="font-bold text-base">Sessions</div><div className="text-xs text-muted">Operator session history</div></div></div></Link>

        <Link href="/admin/skus" className="card p-4 hover-card">
          <div className="row">
            <Tag size={20} color="var(--color-primary)" />
            <div>
              <div className="font-bold text-base">SKU Management</div>
              <div className="text-xs text-muted">Amazon SKUs, ASINs, Barcodes</div>
            </div>
          </div>
        </Link>

        <Link href="/admin/locations" className="card p-4 hover-card">
          <div className="row">
            <MapPin size={20} color="var(--color-info)" />
            <div>
              <div className="font-bold text-base">Warehouse Bins</div>
              <div className="text-xs text-muted">Aisle, Shelf, Bin definitions</div>
            </div>
          </div>
        </Link>

        <Link href="/putaway" className="card p-4 hover-card"><div className="row"><Archive size={20} color="var(--color-info)" /><div><div className="font-bold text-base">Putaway</div><div className="text-xs text-muted">SKU location operations</div></div></div></Link>
        <Link href="/cancelled" className="card p-4 hover-card"><div className="row"><Ban size={20} color="var(--color-error)" /><div><div className="font-bold text-base">Cancelled</div><div className="text-xs text-muted">Orders blocked from packing</div></div></div></Link>
        <Link href="/admin/users" className="card p-4 hover-card">
          <div className="row">
            <Users size={20} color="var(--color-pending)" />
            <div>
              <div className="font-bold text-base">User Roles</div>
              <div className="text-xs text-muted">Packer, Putaway, Admin permissions</div>
            </div>
          </div>
        </Link>
        <Link href="/admin/audit" className="card p-4 hover-card"><div className="row"><ClipboardList size={20} color="var(--color-pending)" /><div><div className="font-bold text-base">Audit Log</div><div className="text-xs text-muted">Administrative activity</div></div></div></Link>
        <Link href="/admin/settings" className="card p-4 hover-card"><div className="row"><Settings2 size={20} color="var(--color-primary)" /><div><div className="font-bold text-base">Settings</div><div className="text-xs text-muted">Operational preferences</div></div></div></Link>
      </div>
    </div>
  );
}
