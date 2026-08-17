'use client';
// src/app/(app)/admin/users/page.tsx
// User Management — Manage user roles (ADMIN, PACKER, PUTAWAY, VIEWER) and access state

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Profile, UserRole } from '@/types/database.types';
import { Users, RefreshCw } from 'lucide-react';

export default function UsersPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    setProfiles((data as Profile[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchUsers();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchUsers]);

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    const supabase = getSupabaseClient();
    const { error } = await (
      supabase.from('profiles') as unknown as {
        update: (data: Record<string, unknown>) => {
          eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
        };
      }
    )
      .update({ role: newRole })
      .eq('id', userId);

    if (error) {
      toast.error(`Failed to update role: ${error.message}`);
    } else {
      toast.success('✓ User role updated');
      fetchUsers();
    }
  };

  const handleToggleActive = async (userId: string, currentState: boolean) => {
    const supabase = getSupabaseClient();
    const { error } = await (
      supabase.from('profiles') as unknown as {
        update: (data: Record<string, unknown>) => {
          eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
        };
      }
    )
      .update({ is_active: !currentState })
      .eq('id', userId);

    if (error) {
      toast.error(`Failed to update status: ${error.message}`);
    } else {
      toast.success(`✓ User ${!currentState ? 'activated' : 'deactivated'}`);
      fetchUsers();
    }
  };

  return (
    <div className="stack">
      <div className="row row--between">
        <div>
          <h1 className="text-2xl font-extrabold row" style={{ gap: 8 }}>
            <Users size={24} color="var(--color-pending)" /> User Roles & Access
          </h1>
          <p className="text-sm text-secondary">
            Grant packer, putaway, or admin authorizations enforced at database RLS level
          </p>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={fetchUsers} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {loading && profiles.length === 0 ? (
        <div className="card text-center p-4">
          <div className="spinner" style={{ margin: '0 auto 8px' }} />
          <div className="text-sm text-secondary">Loading user profiles…</div>
        </div>
      ) : profiles.length === 0 ? (
        <div className="empty-state card">
          <Users size={48} color="var(--text-muted)" />
          <h3 className="text-lg font-bold">No Users Found</h3>
          <p className="text-sm text-muted mt-1">
            Users will automatically appear here when they register via Supabase Auth.
          </p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>User / Name</th>
                <th>Display Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.id}>
                  <td className="font-semibold text-sm">
                    {profile.full_name}
                  </td>
                  <td className="text-sm text-secondary">
                    {profile.display_name || '—'}
                  </td>
                  <td>
                    <select
                      className="form-input"
                      style={{ padding: '4px 8px', fontSize: 13, height: 'auto', minHeight: 32 }}
                      value={profile.role}
                      onChange={(e) => handleRoleChange(profile.id, e.target.value as UserRole)}
                    >
                      <option value="PACKER">PACKER</option>
                      <option value="PUTAWAY">PUTAWAY</option>
                      <option value="ADMIN">ADMIN</option>
                      <option value="VIEWER">VIEWER</option>
                    </select>
                  </td>
                  <td>
                    <span className={`badge ${profile.is_active ? 'status-success' : 'status-error'}`}>
                      {profile.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td>
                    <button
                      className={`btn btn--sm ${profile.is_active ? 'btn--ghost' : 'btn--primary'}`}
                      style={{ padding: '2px 8px', fontSize: 12, minHeight: 28 }}
                      onClick={() => handleToggleActive(profile.id, profile.is_active)}
                    >
                      {profile.is_active ? 'Deactivate' : 'Activate'}
                    </button>
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
