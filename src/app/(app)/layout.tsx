'use client';
// src/app/(app)/layout.tsx
// Main App Layout with header, bottom/side navigation, and offline banner

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { QrCode, ListCheck, History, Ban, Archive, Shield, LogOut } from 'lucide-react';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Profile } from '@/types/database.types';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        if (data) setProfile(data as Profile);
      }
    });
  }, []);

  const handleLogout = async () => {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  const navItems = [
    { href: '/scan', label: 'Pack', icon: QrCode },
    { href: '/queue', label: 'Queue', icon: ListCheck },
    { href: '/history', label: 'History', icon: History },
    { href: '/cancelled', label: 'Cancelled', icon: Ban },
    { href: '/putaway', label: 'Putaway', icon: Archive },
  ];

  if (profile?.role === 'ADMIN') {
    navItems.push({ href: '/admin', label: 'Admin', icon: Shield });
  }

  return (
    <div className="app-shell">
      <OfflineBanner />

      <header className="app-header">
        <div className="app-header__logo">
          REYO <span>PACK</span>
        </div>

        <div className="row" style={{ gap: 12 }}>
          {profile && (
            <div className="text-right">
              <div className="text-xs font-semibold text-primary">
                {profile.display_name || profile.full_name}
              </div>
              <div className="text-xs text-muted font-mono">{profile.role}</div>
            </div>
          )}
          <button
            className="btn btn--ghost btn--sm"
            onClick={handleLogout}
            title="Log out"
            aria-label="Log out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1 }}>
        <nav className="app-nav" aria-label="Main Navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== '/scan' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`app-nav__item ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <main className="app-main" style={{ width: '100%' }}>
          <div className="container container--wide">{children}</div>
        </main>
      </div>
    </div>
  );
}
