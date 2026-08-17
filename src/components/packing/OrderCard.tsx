'use client';
// src/components/packing/OrderCard.tsx
// Displays exact scan result screen specified in production requirements
// Primary Product Image → Exact Title → QTY → AWB → Operational Status

import { ImageOff, MapPin, Tag, Hash, AlertOctagon, CheckCircle2 } from 'lucide-react';
import type { AwbLookupResult } from '@/types/database.types';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDateTime } from '@/lib/utils/formatters';

interface OrderCardProps {
  order: AwbLookupResult;
  awb?: string;
}

export function OrderCard({ order, awb }: OrderCardProps) {
  const isCancelled = order.status === 'CANCELLED';
  const isProcessed = order.status === 'PACKED' || order.status === 'SHIPPED';
  const displayAwb = awb || order.awb || '—';
  const items = order.items || [];

  return (
    <div
      className={`order-card fade-in ${isCancelled ? 'card--error' : isProcessed ? 'card--success' : ''}`}
      role="region"
      aria-label={`Scan Result for Order ${order.amazon_order_id}`}
    >
      {/* Header Banner */}
      <div className="order-card__header">
        <div className="stack stack--sm">
          <div className="row" style={{ gap: 8 }}>
            <span className="font-extrabold text-success text-sm" style={{ letterSpacing: '0.05em' }}>
              ORDER FOUND ✓
            </span>
            <StatusBadge status={order.status || 'PENDING'} />
          </div>
          <div className="order-card__order-id">
            #{order.amazon_order_id}
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div className="text-xs text-muted font-semibold" style={{ textTransform: 'uppercase' }}>
            {order.resolved_by === 'AMAZON_ORDER_ID' ? 'Resolution' : 'AWB'}
          </div>
          <div className="font-mono font-bold text-sm text-primary">
            {order.resolved_by === 'AMAZON_ORDER_ID' ? 'Amazon Order ID' : displayAwb}
          </div>
        </div>
      </div>

      {/* Cancelled Warning Banner */}
      {isCancelled && (
        <div className="card--error p-4 row" style={{ gap: 12, borderRadius: 0 }} role="alert">
          <AlertOctagon size={28} color="var(--color-error)" />
          <div>
            <div className="font-extrabold text-base text-error" style={{ letterSpacing: '0.04em' }}>
              ⚠ ORDER CANCELLED — DO NOT PACK
            </div>
            <div className="text-xs text-muted mt-1">
              Amazon reports this order was cancelled. Action buttons are disabled.
            </div>
          </div>
        </div>
      )}

      {/* Already Processed Notice */}
      {isProcessed && (
        <div className="card--success p-4 stack stack--sm" style={{ borderRadius: 0 }} role="alert">
          <div className="row" style={{ gap: 8 }}>
            <CheckCircle2 size={20} color="var(--color-success)" />
            <span className="font-bold text-base text-success">ALREADY PROCESSED</span>
          </div>
          <div className="row text-xs text-muted" style={{ gap: 16, flexWrap: 'wrap' }}>
            {order.packed_at && (
              <div>
                Packed at: <strong className="text-secondary">{formatDateTime(order.packed_at)}</strong>
              </div>
            )}
            {order.packed_by_name && (
              <div>
                User: <strong className="text-secondary">{order.packed_by_name}</strong>
              </div>
            )}
            {order.last_event?.session_id && (
              <div>
                Session: <strong className="text-secondary font-mono">#{order.last_event.session_id.slice(0, 8)}</strong>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Item Display with Large Product Image */}
      <div className="order-card__body">
        {items.length === 0 ? (
          <div className="text-sm text-muted text-center py-4">No order items found</div>
        ) : (
          items.map((item, idx) => (
            <div
              key={item.order_item_id || idx}
              className="stack stack--md"
              style={{
                paddingBottom: idx < items.length - 1 ? 16 : 0,
                borderBottom: idx < items.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}
            >
              {/* Large Product Image Container */}
              <div
                style={{
                  width: '100%',
                  height: 220,
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-default)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  position: 'relative',
                }}
                aria-label={`Product Image for ${item.title}`}
              >
                {item.image_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={item.image_url}
                    alt={item.title || 'Product Image'}
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <div className="stack stack--sm text-center" style={{ alignItems: 'center', color: 'var(--text-muted)' }}>
                    <ImageOff size={40} opacity={0.4} />
                    <span className="text-xs font-semibold" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      PRODUCT IMAGE UNAVAILABLE
                    </span>
                  </div>
                )}

                <div
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: 'var(--radius-md)',
                    padding: '4px 12px',
                    fontWeight: 800,
                    fontSize: 16,
                    color: 'var(--text-primary)',
                  }}
                  aria-label={`Quantity: ${item.quantity_ordered}`}
                >
                  QTY: {item.quantity_ordered}
                </div>
              </div>

              {/* Exact Product Title */}
              <div>
                <h2
                  className="text-lg font-bold text-primary"
                  style={{ lineHeight: 1.35 }}
                >
                  {item.title || item.amazon_sku || item.asin || 'Unknown Product'}
                </h2>

                <div className="row mt-2" style={{ gap: 12, flexWrap: 'wrap' }}>
                  {item.amazon_sku && (
                    <span className="text-xs font-mono text-muted row" style={{ gap: 4 }}>
                      <Tag size={12} /> {item.amazon_sku}
                    </span>
                  )}
                  {item.asin && (
                    <span className="text-xs font-mono text-muted row" style={{ gap: 4 }}>
                      <Hash size={12} /> {item.asin}
                    </span>
                  )}
                  {item.location && (
                    <span className="order-card__location">
                      <MapPin size={12} /> {item.location}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
