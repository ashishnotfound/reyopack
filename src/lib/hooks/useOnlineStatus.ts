'use client';
// src/lib/hooks/useOnlineStatus.ts
// Tracks browser online/offline state

import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let listening = false;
let notifyOnlineStatus: (() => void) | null = null;

function getSnapshot(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  if (!listening && typeof window !== 'undefined') {
    notifyOnlineStatus = () => listeners.forEach((callback) => callback());
    window.addEventListener('online', notifyOnlineStatus);
    window.addEventListener('offline', notifyOnlineStatus);
    listening = true;
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && listening && typeof window !== 'undefined') {
      if (notifyOnlineStatus) {
        window.removeEventListener('online', notifyOnlineStatus);
        window.removeEventListener('offline', notifyOnlineStatus);
      }
      notifyOnlineStatus = null;
      listening = false;
    }
  };
}

export function useOnlineStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
