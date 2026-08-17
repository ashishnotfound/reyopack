-- ============================================================
-- REYO PACK — ATOMIC DB FUNCTIONS
-- Migration: 003_functions.sql
-- ============================================================

-- ============================================================
-- FUNCTION: atomic_pack_order
-- Called from Edge Function via service role
-- Implements SELECT FOR UPDATE + duplicate prevention
-- ============================================================

CREATE OR REPLACE FUNCTION atomic_pack_order(
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
  v_result      JSONB;
BEGIN
  -- Lock the order row to prevent concurrent packing
  SELECT * INTO v_order
  FROM orders
  WHERE amazon_order_id = p_amazon_order_id
  FOR UPDATE NOWAIT;

  -- Order not found
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ORDER_NOT_FOUND',
      'message', 'Order not found: ' || p_amazon_order_id
    );
  END IF;

  -- Order is cancelled
  IF v_order.status = 'CANCELLED' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ORDER_CANCELLED',
      'message', 'Order is cancelled and cannot be packed',
      'order_id', v_order.id,
      'amazon_order_id', v_order.amazon_order_id
    );
  END IF;

  -- Order already packed (check orders table)
  IF v_order.status = 'PACKED' OR v_order.packed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ALREADY_PACKED',
      'message', 'Order was already packed',
      'order_id', v_order.id,
      'amazon_order_id', v_order.amazon_order_id,
      'packed_at', v_order.packed_at,
      'packed_by', v_order.packed_by
    );
  END IF;

  -- Double-check packing_events (unique constraint will catch race conditions)
  IF EXISTS (SELECT 1 FROM packing_events WHERE order_id = v_order.id) THEN
    SELECT pe.packed_at INTO v_order.packed_at
    FROM packing_events pe WHERE pe.order_id = v_order.id;
    
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ALREADY_PACKED',
      'message', 'Order was already packed (event exists)',
      'order_id', v_order.id,
      'amazon_order_id', v_order.amazon_order_id,
      'packed_at', v_order.packed_at
    );
  END IF;

  -- Create the packing event
  INSERT INTO packing_events (
    order_id,
    session_id,
    packed_by,
    awb_scanned,
    device_info,
    packed_at
  ) VALUES (
    v_order.id,
    p_session_id,
    p_packer_id,
    p_awb_scanned,
    p_device_info,
    now()
  )
  RETURNING id INTO v_event_id;

  -- Update order status
  UPDATE orders
  SET
    status = 'PACKED',
    packed_at = now(),
    packed_by = p_packer_id,
    updated_at = now()
  WHERE id = v_order.id;

  -- Update session order count
  IF p_session_id IS NOT NULL THEN
    UPDATE packing_sessions
    SET orders_packed = orders_packed + 1
    WHERE id = p_session_id;
  END IF;

  -- Write audit log
  INSERT INTO audit_logs (
    table_name, record_id, action, actor_id, new_data
  ) VALUES (
    'orders',
    v_order.id,
    'PACK',
    p_packer_id,
    jsonb_build_object(
      'amazon_order_id', v_order.amazon_order_id,
      'packed_at', now(),
      'awb_scanned', p_awb_scanned,
      'packing_event_id', v_event_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'PACKED',
    'message', 'Order packed successfully',
    'order_id', v_order.id,
    'amazon_order_id', v_order.amazon_order_id,
    'packing_event_id', v_event_id,
    'packed_at', now()
  );

EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'LOCK_CONFLICT',
      'message', 'Order is currently being processed by another device. Please retry.'
    );
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ALREADY_PACKED',
      'message', 'Order was already packed (race condition caught)',
      'amazon_order_id', p_amazon_order_id
    );
END;
$$;

-- ============================================================
-- FUNCTION: lookup_order_by_awb
-- Called from frontend via RPC (authenticated)
-- ============================================================

CREATE OR REPLACE FUNCTION lookup_order_by_awb(p_awb TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT
    jsonb_build_object(
      'order_id', o.id,
      'amazon_order_id', o.amazon_order_id,
      'status', o.status,
      'purchase_date', o.purchase_date,
      'packed_at', o.packed_at,
      'packed_by', o.packed_by,
      'buyer_name', o.buyer_name,
      'ship_city', o.ship_city,
      'ship_state', o.ship_state,
      'awb', s.awb_number,
      'carrier', s.carrier,
      'label_url', s.label_url,
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

  IF v_result IS NULL THEN
    RETURN jsonb_build_object(
      'found', false,
      'message', 'No order found for AWB: ' || p_awb
    );
  END IF;

  RETURN v_result || jsonb_build_object('found', true);
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION lookup_order_by_awb(TEXT) TO authenticated;

-- ============================================================
-- FUNCTION: upsert_sku_location (for putaway)
-- ============================================================

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
AS $$
DECLARE
  v_old_location_id UUID;
  v_putter UUID;
BEGIN
  v_putter := COALESCE(p_put_by, auth.uid());

  -- Get current location for history
  SELECT location_id INTO v_old_location_id
  FROM sku_location_mappings
  WHERE sku_id = p_sku_id;

  -- Upsert the mapping
  INSERT INTO sku_location_mappings (sku_id, location_id, quantity, updated_by, updated_at)
  VALUES (p_sku_id, p_location_id, COALESCE(p_quantity, 0), v_putter, now())
  ON CONFLICT (sku_id) DO UPDATE SET
    location_id = EXCLUDED.location_id,
    quantity = COALESCE(p_quantity, sku_location_mappings.quantity),
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

  -- Write putaway event
  INSERT INTO putaway_events (
    sku_id,
    from_location_id,
    to_location_id,
    action,
    quantity,
    put_by,
    notes
  ) VALUES (
    p_sku_id,
    v_old_location_id,
    p_location_id,
    CASE WHEN v_old_location_id IS NULL THEN 'ASSIGNED'::putaway_action ELSE 'MOVED'::putaway_action END,
    p_quantity,
    v_putter,
    p_notes
  );

  -- Audit log
  INSERT INTO audit_logs (table_name, record_id, action, actor_id, new_data)
  VALUES (
    'sku_location_mappings', p_sku_id, 'PUTAWAY', v_putter,
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

GRANT EXECUTE ON FUNCTION upsert_sku_location(UUID, UUID, INTEGER, UUID, TEXT) TO authenticated;

-- Revoke default PUBLIC execute on helper functions & grant explicitly to authenticated
REVOKE EXECUTE ON FUNCTION get_my_role() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION has_role(user_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_packer_or_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_putaway_or_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_authenticated_and_active() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION get_my_role() TO authenticated;
GRANT EXECUTE ON FUNCTION has_role(user_role) TO authenticated;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION is_packer_or_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION is_putaway_or_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION is_authenticated_and_active() TO authenticated;
