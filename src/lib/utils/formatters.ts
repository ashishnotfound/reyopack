// src/lib/utils/formatters.ts
// Display formatting utilities

export function formatOrderId(amazonOrderId: string): string {
  return amazonOrderId || '—';
}

export function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatCurrency(
  amount: number | null | undefined,
  currency = 'INR'
): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${min}m ${remSec}s`;
}

export function truncate(text: string | null | undefined, length = 60): string {
  if (!text) return '—';
  return text.length > length ? text.slice(0, length) + '…' : text;
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'PACKED':
    case 'SHIPPED':
    case 'SUCCESS':
      return 'status-success';
    case 'PENDING':
    case 'UNSHIPPED':
    case 'RUNNING':
      return 'status-pending';
    case 'CANCELLED':
    case 'FAILED':
      return 'status-error';
    case 'PARTIAL':
    case 'RETURNED':
      return 'status-warning';
    default:
      return 'status-neutral';
  }
}

export function getStatusLabel(status: string): string {
  switch (status) {
    case 'PENDING': return 'Pending';
    case 'UNSHIPPED': return 'Unshipped';
    case 'PACKED': return 'Packed';
    case 'SHIPPED': return 'Shipped';
    case 'CANCELLED': return 'Cancelled';
    case 'RETURNED': return 'Returned';
    case 'RUNNING': return 'Syncing…';
    case 'SUCCESS': return 'Success';
    case 'FAILED': return 'Failed';
    case 'PARTIAL': return 'Partial';
    default: return status;
  }
}
