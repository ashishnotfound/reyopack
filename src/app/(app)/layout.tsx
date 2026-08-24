'use client';
// src/app/(app)/layout.tsx
// Main App Layout with header, bottom/side navigation, and offline banner

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { QrCode, ListCheck, History, Archive, Shield, LogOut } from 'lucide-react';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Profile } from '@/types/database.types';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseClient();
    let active = true;

    const redirectToLogin = () => {
      const currentPath = `${window.location.pathname}${window.location.search}`;
      router.replace(`/login?redirectTo=${encodeURIComponent(currentPath || '/scan')}`);
    };

    const loadSession = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (active) {
          setProfile(null);
          setIsAuthenticated(false);
          setAuthReady(true);
        }
        redirectToLogin();
        return;
      }

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (active) {
        if (data) setProfile(data as Profile);
        setIsAuthenticated(true);
        setAuthReady(true);
      }
    };

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session || event === 'SIGNED_OUT') {
        if (active) {
          setProfile(null);
          setIsAuthenticated(false);
          setAuthReady(true);
        }
        redirectToLogin();
      } else if (event === 'SIGNED_IN') {
        void loadSession();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  const handleLogout = async () => {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  const navItems = [
    { href: '/scan', label: 'Pack', icon: QrCode },
    { href: '/queue', label: 'Queue', icon: ListCheck },
    { href: '/history', label: 'History', icon: History },
    { href: '/putaway', label: 'Putaway', icon: Archive },
  ];

  if (profile?.role === 'ADMIN') {
    navItems.push({ href: '/admin', label: 'Admin', icon: Shield });
  }

  if (!authReady || !isAuthenticated) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        Checking authentication…
      </div>
    );
  }

  return (
    <div className="app-shell">
      <OfflineBanner />

      <header className="app-header">
        <div className="app-header__logo">
          REYO <span>PACK</span>
        </div>

        <div className="row" style={{ gap: 12 }}>
          <ConnectionStatus />
          {profile?.role === 'ADMIN' && (
            <Link href="/admin" className="app-header__admin-link" aria-label="Open Admin">
              <Shield size={15} /> <span>ADMIN</span>
            </Link>
          )}
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
