'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();
  useEffect(() => router.replace('/scan'), [router]);
  return <div className="app-loading">Opening Reyo Pack…</div>;
}
