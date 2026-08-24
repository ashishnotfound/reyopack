'use client';

import { Wifi, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/lib/hooks/useOnlineStatus';

export function ConnectionStatus() {
  const isOnline = useOnlineStatus();

  return (
    <span
      className={`connection-status ${isOnline ? 'connection-status--online' : 'connection-status--offline'}`}
      role="status"
      aria-label={isOnline ? 'Online' : 'Offline'}
    >
      {isOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
      {isOnline ? 'ONLINE' : 'OFFLINE'}
    </span>
  );
}
