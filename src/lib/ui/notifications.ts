'use client';

import { toast, type ToastOptions } from 'react-hot-toast';

function notificationId(kind: string, message: string): string {
  return `${kind}:${message.replace(/\s+/g, ' ').trim().slice(0, 180)}`;
}

export function notifyError(message: string, options?: ToastOptions): string {
  const cleanMessage = message.replace(/\s+/g, ' ').trim();
  return toast.error(cleanMessage, {
    id: notificationId('error', cleanMessage),
    duration: 3500,
    ...options,
  });
}

export function notifySuccess(message: string, options?: ToastOptions): string {
  const cleanMessage = message.replace(/\s+/g, ' ').trim();
  return toast.success(cleanMessage, {
    id: notificationId('success', cleanMessage),
    duration: 2200,
    ...options,
  });
}
