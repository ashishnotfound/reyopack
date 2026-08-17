'use client';
// src/components/ui/StatusBadge.tsx

import { getStatusColor, getStatusLabel } from '@/lib/utils/formatters';

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const colorClass = getStatusColor(status);
  const label = getStatusLabel(status);

  return (
    <span className={`badge ${colorClass} ${className}`} aria-label={`Status: ${label}`}>
      {label}
    </span>
  );
}
