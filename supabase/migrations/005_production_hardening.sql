-- ============================================================
-- REYO PACK — PRODUCTION HARDENING
-- Migration: 005_production_hardening.sql
-- ============================================================

-- The scan/pack hot path is protected by a persistent idempotency key. A
-- retry from the same device can replay the original result without creating
-- another event, while a second device is rejected by the locked order row.
ALTER TABLE packing_events ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE packing_events ALTER COLUMN packed_by DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_packing_events_idempotency
  ON packing_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_packing_events_event_type ON packing_events(event_type);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking_number ON shipments(tracking_number);
CREATE INDEX IF NOT EXISTS idx_orders_cancelled_at ON orders(cancelled_at DESC);

-- Never trust signup metadata for authorization. The first administrator is
-- promoted explicitly by an administrator or a controlled SQL operation.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO profiles (id, full_name, display_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    'PACKER'::user_role
  );
  RETURN NEW;
END;
$$;

-- SECURITY DEFINER functions must have a fixed search path and must not be
-- callable anonymously.
ALTER FUNCTION get_my_role() SET search_path = public, pg_catalog;
ALTER FUNCTION has_role(user_role) SET search_path = public, pg_catalog;
ALTER FUNCTION is_admin() SET search_path = public, pg_catalog;
ALTER FUNCTION is_packer_or_admin() SET search_path = public, pg_catalog;
ALTER FUNCTION is_putaway_or_admin() SET search_path = public, pg_catalog;
ALTER FUNCTION is_authenticated_and_active() SET search_path = public, pg_catalog;
REVOKE EXECUTE ON FUNCTION atomic_pack_order(TEXT, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS atomic_pack_order(TEXT, UUID, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION atomic_pack_order(
  p_amazon_order_id TEXT,
  p_packer_id UUID,
  p_session_id UUID DEFAULT NULL,
  p_awb_scanned TEXT DEFAULT NULL,
  p_device_info TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor_id UUID := COALESCE(auth.uid(), p_packer_id);
  v_order orders%ROWTYPE;
  v_event packing_events%ROWTYPE;
  v_event_id UUID;
  v_units INTEGER := 1;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF auth.uid() IS NULL AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'message', 'Authentication required');
  END IF;
  IF auth.uid() IS NOT NULL AND p_packer_id <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACTOR_MISMATCH', 'message', 'Caller ID mismatch');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_actor_id AND is_active AND role IN ('PACKER', 'ADMIN')) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'message', 'Packer or admin role required');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_event
    FROM packing_events
    WHERE idempotency_key = p_idempotency_key
      AND event_type = 'PACKED'::packing_event_type;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true, 'code', 'REPLAYED', 'message', 'Packing event already confirmed',
        'order_id', v_event.order_id, 'packing_event_id', v_event.id,
        'packed_at', v_event.packed_at, 'packed_by', v_event.packed_by
      );
    END IF;
  END IF;

  SELECT * INTO v_order
  FROM orders
  WHERE amazon_order_id = p_amazon_order_id
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_FOUND', 'message', 'Order not found: ' || p_amazon_order_id);
  END IF;
  IF v_order.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('success', false, 'code', 'ORDER_CANCELLED', 'message', 'Order is cancelled and cannot be packed', 'order_id', v_order.id);
  END IF;
  IF v_order.status IN ('PACKED', 'SHIPPED') OR v_order.packed_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'ALREADY_PACKED', 'message', 'Order was already packed', 'order_id', v_order.id, 'packed_at', v_order.packed_at, 'packed_by', v_order.packed_by);
  END IF;
  IF p_session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM packing_sessions WHERE id = p_session_id AND packer_id = v_actor_id AND ended_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_SESSION', 'message', 'Start an active packing session before confirming a package');
  END IF;

  SELECT COALESCE(SUM(quantity_ordered), 1) INTO v_units FROM order_items WHERE order_id = v_order.id;

  INSERT INTO packing_events (order_id, session_id, packed_by, awb_scanned, device_info, event_type, idempotency_key, packed_at)
  VALUES (v_order.id, p_session_id, v_actor_id, p_awb_scanned, p_device_info, 'PACKED'::packing_event_type, p_idempotency_key, v_now)
  RETURNING id INTO v_event_id;

  UPDATE orders SET status = 'PACKED', packed_at = v_now, packed_by = v_actor_id, updated_at = v_now WHERE id = v_order.id;
  IF p_session_id IS NOT NULL THEN
    UPDATE packing_sessions SET orders_packed = orders_packed + 1, units_packed = units_packed + v_units WHERE id = p_session_id;
  END IF;
  INSERT INTO audit_logs (table_name, record_id, action, actor_id, new_data)
  VALUES ('orders', v_order.id, 'PACKED', v_actor_id, jsonb_build_object('amazon_order_id', v_order.amazon_order_id, 'awb', p_awb_scanned, 'event_id', v_event_id, 'units', v_units));

  RETURN jsonb_build_object('success', true, 'code', 'PACKED', 'message', 'Order packed successfully', 'order_id', v_order.id, 'amazon_order_id', v_order.amazon_order_id, 'packing_event_id', v_event_id, 'packed_at', v_now, 'packed_by', v_actor_id);
EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('success', false, 'code', 'LOCK_CONFLICT', 'message', 'Order is currently being processed by another device. Please retry.');
  WHEN unique_violation THEN
    IF p_idempotency_key IS NOT NULL THEN
      SELECT * INTO v_event FROM packing_events WHERE idempotency_key = p_idempotency_key;
      IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'code', 'REPLAYED', 'message', 'Packing event already confirmed', 'order_id', v_event.order_id, 'packing_event_id', v_event.id, 'packed_at', v_event.packed_at);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'code', 'ALREADY_PACKED', 'message', 'Order was already packed by another device');
END;
$$;

REVOKE EXECUTE ON FUNCTION atomic_pack_order(TEXT, UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION atomic_pack_order(TEXT, UUID, UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- Re-assert authenticated actor checks on the checking and putaway RPCs.
CREATE OR REPLACE FUNCTION atomic_check_order(
  p_amazon_order_id TEXT,
  p_packer_id UUID DEFAULT NULL,
  p_session_id UUID DEFAULT NULL,
  p_awb_scanned TEXT DEFAULT NULL,
  p_device_info TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_order orders%ROWTYPE;
  v_event_id UUID;
BEGIN
  IF v_actor_id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'message', 'Authentication required'); END IF;
  IF p_packer_id IS NOT NULL AND p_packer_id <> v_actor_id THEN RETURN jsonb_build_object('success', false, 'code', 'ACTOR_MISMATCH', 'message', 'Caller ID mismatch'); END IF;
  IF NOT is_packer_or_admin() THEN RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'message', 'Packer or admin role required'); END IF;
  SELECT * INTO v_order FROM orders WHERE amazon_order_id = p_amazon_order_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_FOUND', 'message', 'Order not found'); END IF;
  IF v_order.status = 'CANCELLED' THEN RETURN jsonb_build_object('success', false, 'code', 'ORDER_CANCELLED', 'message', 'Order is cancelled and cannot be packed'); END IF;
  IF p_session_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM packing_sessions WHERE id = p_session_id AND packer_id = v_actor_id AND ended_at IS NULL) THEN RETURN jsonb_build_object('success', false, 'code', 'INVALID_SESSION', 'message', 'Start an active packing session before checking'); END IF;
  INSERT INTO packing_events (order_id, session_id, packed_by, awb_scanned, device_info, event_type, packed_at) VALUES (v_order.id, p_session_id, v_actor_id, p_awb_scanned, p_device_info, 'CHECKING'::packing_event_type, now()) RETURNING id INTO v_event_id;
  IF v_order.status IN ('PENDING', 'UNSHIPPED') THEN UPDATE orders SET status = 'CHECKING', updated_at = now() WHERE id = v_order.id; END IF;
  RETURN jsonb_build_object('success', true, 'code', 'CHECKING_RECORDED', 'message', 'Checking status recorded', 'event_id', v_event_id, 'checked_at', now());
EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('success', false, 'code', 'LOCK_CONFLICT', 'message', 'Order is currently locked by another device');
END;
$$;

CREATE OR REPLACE FUNCTION lookup_order_by_awb(p_awb TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT is_authenticated_and_active() THEN RETURN jsonb_build_object('found', false, 'code', 'FORBIDDEN', 'message', 'Authentication required'); END IF;
  SELECT jsonb_build_object(
    'order_id', o.id, 'amazon_order_id', o.amazon_order_id, 'status', o.status, 'purchase_date', o.purchase_date,
    'packed_at', o.packed_at, 'packed_by', o.packed_by,
    'packed_by_name', (SELECT COALESCE(display_name, full_name) FROM profiles WHERE id = o.packed_by),
    'buyer_name', o.buyer_name, 'ship_city', o.ship_city, 'ship_state', o.ship_state,
    'awb', s.awb_number, 'carrier', s.carrier, 'label_url', s.label_url, 'resolved_by', 'AWB_EXACT',
    'items', (SELECT jsonb_agg(jsonb_build_object(
      'order_item_id', oi.id, 'asin', oi.asin, 'amazon_sku', oi.amazon_sku,
      'title', COALESCE(oi.title, sk.title, p.title), 'quantity_ordered', oi.quantity_ordered,
      'quantity_shipped', oi.quantity_shipped, 'sku_id', oi.sku_id,
      'image_url', COALESCE((SELECT image_url FROM product_images WHERE product_id = p.id AND is_primary LIMIT 1), p.image_url),
      'location', (SELECT wl.code FROM sku_location_mappings slm JOIN warehouse_locations wl ON wl.id = slm.location_id WHERE slm.sku_id = oi.sku_id LIMIT 1)
    )) FROM order_items oi LEFT JOIN skus sk ON sk.id = oi.sku_id LEFT JOIN products p ON p.id = sk.product_id WHERE oi.order_id = o.id)
  ) INTO v_result
  FROM shipments s JOIN orders o ON o.id = s.order_id WHERE s.awb_number = p_awb;
  IF v_result IS NULL AND p_awb ~ '^\d{3}-\d{7}-\d{7}$' THEN
    SELECT jsonb_build_object(
      'order_id', o.id, 'amazon_order_id', o.amazon_order_id, 'status', o.status, 'purchase_date', o.purchase_date,
      'packed_at', o.packed_at, 'packed_by', o.packed_by, 'resolved_by', 'AMAZON_ORDER_ID',
      'items', (SELECT jsonb_agg(jsonb_build_object('order_item_id', oi.id, 'asin', oi.asin, 'amazon_sku', oi.amazon_sku, 'title', COALESCE(oi.title, sk.title, p.title), 'quantity_ordered', oi.quantity_ordered, 'quantity_shipped', oi.quantity_shipped, 'sku_id', oi.sku_id, 'location', (SELECT wl.code FROM sku_location_mappings slm JOIN warehouse_locations wl ON wl.id = slm.location_id WHERE slm.sku_id = oi.sku_id LIMIT 1))) FROM order_items oi LEFT JOIN skus sk ON sk.id = oi.sku_id LEFT JOIN products p ON p.id = sk.product_id WHERE oi.order_id = o.id)
    ) INTO v_result FROM orders o WHERE o.amazon_order_id = p_awb;
  END IF;
  IF v_result IS NULL THEN RETURN jsonb_build_object('found', false, 'code', 'BARCODE_NOT_FOUND', 'message', 'No shipment matches AWB: ' || p_awb); END IF;
  RETURN v_result || jsonb_build_object('found', true);
END;
$$;

CREATE OR REPLACE FUNCTION upsert_sku_location(p_sku_id UUID, p_location_id UUID, p_quantity INTEGER DEFAULT NULL, p_put_by UUID DEFAULT NULL, p_notes TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_actor_id UUID := auth.uid(); v_old_location_id UUID;
BEGIN
  IF v_actor_id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'message', 'Authentication required'); END IF;
  IF p_put_by IS NOT NULL AND p_put_by <> v_actor_id THEN RETURN jsonb_build_object('success', false, 'code', 'ACTOR_MISMATCH', 'message', 'Caller ID mismatch'); END IF;
  IF NOT is_putaway_or_admin() THEN RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'message', 'Putaway or admin role required'); END IF;
  SELECT location_id INTO v_old_location_id FROM sku_location_mappings WHERE sku_id = p_sku_id;
  INSERT INTO sku_location_mappings (sku_id, location_id, quantity, updated_by, updated_at) VALUES (p_sku_id, p_location_id, COALESCE(p_quantity, 0), v_actor_id, now())
    ON CONFLICT (sku_id) DO UPDATE SET location_id = EXCLUDED.location_id, quantity = COALESCE(p_quantity, sku_location_mappings.quantity), updated_by = EXCLUDED.updated_by, updated_at = now();
  INSERT INTO putaway_events (sku_id, from_location_id, to_location_id, action, quantity, put_by, notes) VALUES (p_sku_id, v_old_location_id, p_location_id, CASE WHEN v_old_location_id IS NULL THEN 'ASSIGNED'::putaway_action ELSE 'MOVED'::putaway_action END, p_quantity, v_actor_id, p_notes);
  INSERT INTO audit_logs (table_name, record_id, action, actor_id, new_data) VALUES ('sku_location_mappings', p_sku_id, 'PUTAWAY', v_actor_id, jsonb_build_object('from_location_id', v_old_location_id, 'to_location_id', p_location_id, 'quantity', p_quantity));
  RETURN jsonb_build_object('success', true, 'sku_id', p_sku_id, 'location_id', p_location_id, 'old_location_id', v_old_location_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION lookup_order_by_awb(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION upsert_sku_location(UUID, UUID, INTEGER, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION lookup_order_by_awb(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_sku_location(UUID, UUID, INTEGER, UUID, TEXT) TO authenticated;

-- The old SHIPPED_BY_MYSELF RPC is retained only for migration compatibility;
-- all current clients use atomic_pack_order.
REVOKE EXECUTE ON FUNCTION atomic_ship_order(TEXT, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
