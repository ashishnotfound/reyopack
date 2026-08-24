'use client';
// src/components/ui/OfflineBanner.tsx

import { useOnlineStatus } from '@/lib/hooks/useOnlineStatus';
import { WifiOff } from 'lucide-react';

export function OfflineBanner() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <WifiOff size={16} />
      <span>OFFLINE · actions paused · reconnecting…</span>
    </div>
  );
}
