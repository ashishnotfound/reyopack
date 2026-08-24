'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Profile } from '@/types/database.types';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const checkAccess = async () => {
      const supabase = getSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login?redirectTo=/admin');
        return;
      }
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (!active) return;
      const profile = data as Profile | null;
      if (profile?.role === 'ADMIN' && profile.is_active) setAuthorized(true);
      else router.replace('/scan');
    };
    void checkAccess();
    return () => { active = false; };
  }, [router]);

  if (!authorized) return <div className="app-loading">Checking Admin access…</div>;
  return children;
}
