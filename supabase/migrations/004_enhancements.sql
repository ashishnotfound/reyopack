-- ============================================================
-- REYO PACK — PRODUCTION ENHANCEMENTS & IMMUTABLE HISTORY
-- Migration: 004_enhancements.sql
-- ============================================================

-- Add new values to order_status enum if not existing
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'CHECKING';

-- Create event_type enum for immutable tracking
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'packing_event_type') THEN
    CREATE TYPE packing_event_type AS ENUM ('SCANNED', 'CHECKING', 'SHIPPED_BY_MYSELF', 'PACKED', 'CANCELLED');
  END IF;
END;
$$;

-- ============================================================
-- PRODUCT IMAGES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS product_images (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id    UUID REFERENCES products(id) ON DELETE CASCADE,
  sku_id        UUID REFERENCES skus(id) ON DELETE CASCADE,
  image_url     TEXT NOT NULL,
  is_primary    BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_sku ON product_images(sku_id);
CREATE INDEX IF NOT EXISTS idx_product_images_primary ON product_images(is_primary);

-- Enable RLS on product_images
ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_images_select ON product_images FOR SELECT
  USING (is_authenticated_and_active());

CREATE POLICY product_images_admin_write ON product_images FOR ALL
  USING (is_admin());

-- ============================================================
-- UPDATE PACKING_EVENTS & PACKING_SESSIONS
-- ============================================================

-- Add event_type column to packing_events if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='packing_events' AND column_name='event_type') THEN
    ALTER TABLE packing_events ADD COLUMN event_type packing_event_type NOT NULL DEFAULT 'SHIPPED_BY_MYSELF';
  END IF;
END;
$$;

-- Remove unique constraint on packing_events order_id so multiple events (e.g. CHECKING then SHIPPED_BY_MYSELF) are stored immutably
ALTER TABLE packing_events DROP CONSTRAINT IF EXISTS packing_events_order_id_key;

-- Add tracking columns to packing_sessions
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='packing_sessions' AND column_name='units_packed') THEN
    ALTER TABLE packing_sessions ADD COLUMN units_packed INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE packing_sessions ADD COLUMN cancelled_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE packing_sessions ADD COLUMN invalid_scans INTEGER NOT NULL DEFAULT 0;
  END IF;
END;
$$;

-- ============================================================
-- FUNCTION: atomic_check_order (Action: CHECKING)
-- ============================================================

CREATE OR REPLACE FUNCTION atomic_check_order(
  p_amazon_order_id TEXT,
  p_packer_id       UUID,
  p_session_id      UUID DEFAULT NULL,
  p_awb_scanned     TEXT DEFAULT NULL,
  p_device_info     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order       orders%ROWTYPE;
  v_event_id    UUID;
BEGIN
  -- Lock order row
  SELECT * INTO v_order
  FROM orders
  WHERE amazon_order_id = p_amazon_order_id
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_FOUND', 'message', 'Order not found');
  END IF;

  IF v_order.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('success', false, 'code', 'ORDER_CANCELLED', 'message', 'Order is cancelled');
  END IF;

  -- Create checking event
  INSERT INTO packing_events (
    order_id, session_id, packed_by, awb_scanned, device_info, event_type, packed_at
  ) VALUES (
    v_order.id, p_session_id, p_packer_id, p_awb_scanned, p_device_info, 'CHECKING'::packing_event_type, now()
  ) RETURNING id INTO v_event_id;

  -- Update order status if still PENDING/UNSHIPPED
  IF v_order.status IN ('PENDING', 'UNSHIPPED') THEN
    UPDATE orders SET status = 'CHECKING', updated_at = now() WHERE id = v_order.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'CHECKING_RECORDED',
    'message', 'Checking status recorded',
    'event_id', v_event_id,
    'checked_at', now()
  );
EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('success', false, 'code', 'LOCK_CONFLICT', 'message', 'Order locked by another device');
END;
$$;

-- ============================================================
-- REYO PACK — ENHANCED ATOMIC FUNCTIONS
-- Migration: 004_enhancements.sql
-- ============================================================

-- RPC 1: atomic_check_order (Action: CHECKING)
CREATE OR REPLACE FUNCTION atomic_check_order(
  p_amazon_order_id TEXT,
  p_packer_id       UUID DEFAULT NULL,
  p_session_id      UUID DEFAULT NULL,
  p_awb_scanned     TEXT DEFAULT NULL,
  p_device_info     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor_id    UUID;
  v_order       orders%ROWTYPE;
  v_event_id    UUID;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'message', 'Authentication required');
  END IF;

  IF p_packer_id IS NOT NULL AND p_packer_id != v_actor_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACTOR_MISMATCH', 'message', 'Caller ID mismatch');
  END IF;

  IF NOT is_packer_or_admin() THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'message', 'Permission denied');
  END IF;

  SELECT * INTO v_order
  FROM orders
  WHERE amazon_order_id = p_amazon_order_id
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_FOUND', 'message', 'Order not found: ' || p_amazon_order_id);
  END IF;

  IF v_order.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('success', false, 'code', 'ORDER_CANCELLED', 'message', 'Order is cancelled and cannot be packed');
  END IF;

  IF v_order.status IN ('PACKED', 'SHIPPED') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ALREADY_PROCESSED',
      'message', 'Order was already processed',
      'packed_at', v_order.packed_at,
      'packed_by', v_order.packed_by
    );
  END IF;

  INSERT INTO packing_events (
    order_id, session_id, packed_by, awb_scanned, device_info, event_type, packed_at
  ) VALUES (
    v_order.id, p_session_id, v_actor_id, p_awb_scanned, p_device_info, 'CHECKING'::packing_event_type, now()
  ) RETURNING id INTO v_event_id;

  IF v_order.status IN ('PENDING', 'UNSHIPPED') THEN
    UPDATE orders SET status = 'CHECKING', updated_at = now() WHERE id = v_order.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'CHECKING_RECORDED',
    'message', 'Checking status recorded',
    'event_id', v_event_id,
    'checked_at', now()
  );
EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('success', false, 'code', 'LOCK_CONFLICT', 'message', 'Order is currently locked by another device');
END;
$$;

-- RPC 2: atomic_ship_order (Action: SHIPPED BY MYSELF / PACKED)
CREATE OR REPLACE FUNCTION atomic_ship_order(
  p_amazon_order_id TEXT,
  p_packer_id       UUID DEFAULT NULL,
  p_session_id      UUID DEFAULT NULL,
  p_awb_scanned     TEXT DEFAULT NULL,
  p_device_info     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor_id    UUID;
  v_order       orders%ROWTYPE;
  v_event_id    UUID;
  v_item_count  INTEGER := 0;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'message', 'Authentication required');
  END IF;

  IF p_packer_id IS NOT NULL AND p_packer_id != v_actor_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACTOR_MISMATCH', 'message', 'Caller ID mismatch');
  END IF;

  IF NOT is_packer_or_admin() THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'message', 'Permission denied');
  END IF;

  SELECT * INTO v_order
  FROM orders
  WHERE amazon_order_id = p_amazon_order_id
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_FOUND', 'message', 'Order not found');
  END IF;

  IF v_order.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('success', false, 'code', 'ORDER_CANCELLED', 'message', 'Order is cancelled and cannot be packed');
  END IF;

  IF v_order.status = 'PACKED' OR v_order.status = 'SHIPPED' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ALREADY_PROCESSED',
      'message', 'Order was already processed',
      'packed_at', v_order.packed_at,
      'packed_by', v_order.packed_by
    );
  END IF;

  SELECT COALESCE(SUM(quantity_ordered), 1) INTO v_item_count
  FROM order_items
  WHERE order_id = v_order.id;

  INSERT INTO packing_events (
    order_id, session_id, packed_by, awb_scanned, device_info, event_type, packed_at
  ) VALUES (
    v_order.id, p_session_id, v_actor_id, p_awb_scanned, p_device_info, 'SHIPPED_BY_MYSELF'::packing_event_type, now()
  ) RETURNING id INTO v_event_id;

  UPDATE orders
  SET status = 'PACKED', packed_at = now(), packed_by = v_actor_id, updated_at = now()
  WHERE id = v_order.id;

  IF p_session_id IS NOT NULL THEN
    UPDATE packing_sessions
    SET orders_packed = orders_packed + 1, units_packed = units_packed + v_item_count
    WHERE id = p_session_id;
  END IF;

  INSERT INTO audit_logs (table_name, record_id, action, actor_id, new_data)
  VALUES ('orders', v_order.id, 'SHIPPED_BY_MYSELF', v_actor_id, jsonb_build_object(
    'amazon_order_id', v_order.amazon_order_id,
    'awb', p_awb_scanned,
    'event_id', v_event_id,
    'units', v_item_count
  ));

  RETURN jsonb_build_object(
    'success', true,
    'code', 'SHIPPED_SUCCESSFULLY',
    'message', 'Order shipped by operator',
    'event_id', v_event_id,
    'packed_at', now()
  );
EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('success', false, 'code', 'LOCK_CONFLICT', 'message', 'Order is currently locked by another device');
END;
$$;

-- RPC 3: lookup_order_by_awb (Strict AWB Resolution)
CREATE OR REPLACE FUNCTION lookup_order_by_awb(p_awb TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Primary exact physical-label AWB lookup
  SELECT
    jsonb_build_object(
      'order_id', o.id,
      'amazon_order_id', o.amazon_order_id,
      'status', o.status,
      'purchase_date', o.purchase_date,
      'packed_at', o.packed_at,
      'packed_by', o.packed_by,
      'packed_by_name', (SELECT COALESCE(display_name, full_name) FROM profiles WHERE id = o.packed_by),
      'buyer_name', o.buyer_name,
      'ship_city', o.ship_city,
      'ship_state', o.ship_state,
      'awb', s.awb_number,
      'carrier', s.carrier,
      'label_url', s.label_url,
      'resolved_by', 'AWB_EXACT',
      'last_event', (
        SELECT jsonb_build_object(
          'event_type', pe.event_type,
          'packed_at', pe.packed_at,
          'packer_name', pr.display_name,
          'session_id', pe.session_id
        )
        FROM packing_events pe
        LEFT JOIN profiles pr ON pr.id = pe.packed_by
        WHERE pe.order_id = o.id
        ORDER BY pe.packed_at DESC
        LIMIT 1
      ),
      'items', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'order_item_id', oi.id,
            'asin', oi.asin,
            'amazon_sku', oi.amazon_sku,
            'title', COALESCE(oi.title, sk.title, p.title),
            'quantity_ordered', oi.quantity_ordered,
            'quantity_shipped', oi.quantity_shipped,
            'sku_id', oi.sku_id,
            'image_url', COALESCE(
              (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = true LIMIT 1),
              (SELECT image_url FROM product_images WHERE sku_id = sk.id LIMIT 1),
              p.image_url
            ),
            'location', (
              SELECT wl.code
              FROM sku_location_mappings slm
              JOIN warehouse_locations wl ON wl.id = slm.location_id
              WHERE slm.sku_id = oi.sku_id
              LIMIT 1
            )
          )
        )
        FROM order_items oi
        LEFT JOIN skus sk ON sk.id = oi.sku_id
        LEFT JOIN products p ON p.id = sk.product_id
        WHERE oi.order_id = o.id
      )
    ) INTO v_result
  FROM shipments s
  JOIN orders o ON o.id = s.order_id
  WHERE s.awb_number = p_awb;

  -- Fallback search directly on orders table ONLY if scanned value matches exact Amazon Order ID format (e.g. 403-1234567-1234567)
  -- Note: awb is set to NULL so an Amazon Order ID is never falsely recorded as an AWB barcode!
  IF v_result IS NULL AND p_awb ~ '^\d{3}-\d{7}-\d{7}$' THEN
    SELECT
      jsonb_build_object(
        'order_id', o.id,
        'amazon_order_id', o.amazon_order_id,
        'status', o.status,
        'purchase_date', o.purchase_date,
        'packed_at', o.packed_at,
        'packed_by', o.packed_by,
        'packed_by_name', (SELECT COALESCE(display_name, full_name) FROM profiles WHERE id = o.packed_by),
        'buyer_name', o.buyer_name,
        'ship_city', o.ship_city,
        'ship_state', o.ship_state,
        'awb', NULL,
        'resolved_by', 'AMAZON_ORDER_ID',
        'items', (
          SELECT jsonb_agg(
            jsonb_build_object(
              'order_item_id', oi.id,
              'asin', oi.asin,
              'amazon_sku', oi.amazon_sku,
              'title', COALESCE(oi.title, sk.title, p.title),
              'quantity_ordered', oi.quantity_ordered,
              'quantity_shipped', oi.quantity_shipped,
              'sku_id', oi.sku_id,
              'image_url', COALESCE(
                (SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary = true LIMIT 1),
                p.image_url
              ),
              'location', (
                SELECT wl.code
                FROM sku_location_mappings slm
                JOIN warehouse_locations wl ON wl.id = slm.location_id
                WHERE slm.sku_id = oi.sku_id
                LIMIT 1
              )
            )
          )
          FROM order_items oi
          LEFT JOIN skus sk ON sk.id = oi.sku_id
          LEFT JOIN products p ON p.id = sk.product_id
          WHERE oi.order_id = o.id
        )
      ) INTO v_result
    FROM orders o
    WHERE o.amazon_order_id = p_awb;
  END IF;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('found', false, 'code', 'BARCODE_NOT_FOUND', 'message', 'No shipment matches AWB: ' || p_awb);
  END IF;

  RETURN v_result || jsonb_build_object('found', true);
END;
$$;

-- RPC 4: upsert_sku_location (Putaway Assignment)
CREATE OR REPLACE FUNCTION upsert_sku_location(
  p_sku_id      UUID,
  p_location_id UUID,
  p_quantity    INTEGER DEFAULT NULL,
  p_put_by      UUID DEFAULT NULL,
  p_notes       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor_id        UUID;
  v_old_location_id UUID;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'message', 'Authentication required');
  END IF;

  IF p_put_by IS NOT NULL AND p_put_by != v_actor_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACTOR_MISMATCH', 'message', 'Caller ID mismatch');
  END IF;

  IF NOT is_putaway_or_admin() THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'message', 'Permission denied');
  END IF;

  SELECT location_id INTO v_old_location_id
  FROM sku_location_mappings
  WHERE sku_id = p_sku_id;

  INSERT INTO sku_location_mappings (sku_id, location_id, quantity, updated_by, updated_at)
  VALUES (p_sku_id, p_location_id, COALESCE(p_quantity, 0), v_actor_id, now())
  ON CONFLICT (sku_id) DO UPDATE SET
    location_id = EXCLUDED.location_id,
    quantity = COALESCE(p_quantity, sku_location_mappings.quantity),
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

  INSERT INTO putaway_events (
    sku_id, from_location_id, to_location_id, action, quantity, put_by, notes
  ) VALUES (
    p_sku_id,
    v_old_location_id,
    p_location_id,
    CASE WHEN v_old_location_id IS NULL THEN 'ASSIGNED'::putaway_action ELSE 'MOVED'::putaway_action END,
    p_quantity,
    v_actor_id,
    p_notes
  );

  INSERT INTO audit_logs (table_name, record_id, action, actor_id, new_data)
  VALUES (
    'sku_location_mappings', p_sku_id, 'PUTAWAY', v_actor_id,
    jsonb_build_object(
      'sku_id', p_sku_id,
      'from_location_id', v_old_location_id,
      'to_location_id', p_location_id,
      'quantity', p_quantity
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'sku_id', p_sku_id,
    'location_id', p_location_id,
    'old_location_id', v_old_location_id
  );
END;
$$;

-- Revoke default public execution privileges & grant explicitly to authenticated
REVOKE EXECUTE ON FUNCTION atomic_check_order(TEXT, UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION atomic_ship_order(TEXT, UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION lookup_order_by_awb(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION upsert_sku_location(UUID, UUID, INTEGER, UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION atomic_check_order(TEXT, UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION atomic_ship_order(TEXT, UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION lookup_order_by_awb(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_sku_location(UUID, UUID, INTEGER, UUID, TEXT) TO authenticated;
