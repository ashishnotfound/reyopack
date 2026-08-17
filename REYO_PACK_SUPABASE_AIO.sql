-- ============================================================
-- REYO PACK — CONSOLIDATED ALL-IN-ONE (AIO) PRODUCTION SCHEMA
-- File: REYO_PACK_SUPABASE_AIO.sql
-- Description: Complete, clean, production-ready, idempotent SQL
--              setup script for Reyo Pack Supabase PostgreSQL.
-- Security Hardened: Free of plain-text Amazon secrets. All SECURITY DEFINER
--                    functions specify SET search_path = public, pg_catalog,
--                    validate auth.uid() against caller actor impersonation,
--                    revoke PUBLIC execution, and use pg_publication_tables checks.
-- ============================================================

-- ============================================================
-- 1. EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS "pg_cron";
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron extension not available on this instance; skipping.';
END;
$$;

-- ============================================================
-- 2. ENUMS AND TYPES
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('ADMIN', 'PACKER', 'PUTAWAY', 'VIEWER');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE order_status AS ENUM (
      'PENDING', 'CHECKING', 'PACKED', 'SHIPPED', 'CANCELLED', 'RETURNED', 'UNSHIPPED'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_status') THEN
    CREATE TYPE sync_status AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'putaway_action') THEN
    CREATE TYPE putaway_action AS ENUM ('ASSIGNED', 'MOVED', 'CLEARED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'packing_event_type') THEN
    CREATE TYPE packing_event_type AS ENUM (
      'SCANNED', 'CHECKING', 'SHIPPED_BY_MYSELF', 'PACKED', 'CANCELLED'
    );
  END IF;
END $$;

-- ============================================================
-- 3. PROFILES (Extends auth.users)
-- ============================================================

CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  display_name  TEXT,
  role          user_role NOT NULL DEFAULT 'PACKER',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_active ON profiles(is_active);

-- ============================================================
-- 4. SYSTEM SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS system_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES profiles(id)
);

-- Purge legacy plaintext secrets if present in database
DELETE FROM system_settings
WHERE key IN ('amazon_client_secret', 'amazon_refresh_token', 'amazon_client_id', 'amazon_seller_id');

-- ============================================================
-- 5. PRODUCTS
-- ============================================================

CREATE TABLE IF NOT EXISTS products (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           TEXT NOT NULL,
  brand           TEXT,
  category        TEXT,
  description     TEXT,
  image_url       TEXT,
  weight_grams    INTEGER,
  dimensions_json JSONB,              -- {l, w, h, unit}
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);

-- ============================================================
-- 6. SKUs
-- ============================================================

CREATE TABLE IF NOT EXISTS skus (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id        UUID REFERENCES products(id) ON DELETE SET NULL,
  amazon_sku        TEXT NOT NULL UNIQUE,
  asin              TEXT,
  fnsku             TEXT,
  seller_sku        TEXT,
  title             TEXT,                 -- fallback if no product title
  quantity_per_pack INTEGER NOT NULL DEFAULT 1,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skus_amazon_sku ON skus(amazon_sku);
CREATE INDEX IF NOT EXISTS idx_skus_asin ON skus(asin);
CREATE INDEX IF NOT EXISTS idx_skus_fnsku ON skus(fnsku);
CREATE INDEX IF NOT EXISTS idx_skus_product ON skus(product_id);

-- ============================================================
-- 7. PRODUCT IMAGES
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

-- ============================================================
-- 8. BARCODE MAPPINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS barcode_mappings (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  barcode      TEXT NOT NULL UNIQUE,
  sku_id       UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  barcode_type TEXT NOT NULL DEFAULT 'EAN13',  -- EAN13, UPC, QR, CODE128, FNSKU
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_barcode_mappings_barcode ON barcode_mappings(barcode);
CREATE INDEX IF NOT EXISTS idx_barcode_mappings_sku ON barcode_mappings(sku_id);

-- ============================================================
-- 9. WAREHOUSE LOCATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS warehouse_locations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        TEXT NOT NULL UNIQUE,     -- e.g. A-01-03
  zone        TEXT,                     -- e.g. A, B, INCOMING
  aisle       TEXT,
  shelf       TEXT,
  bin         TEXT,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_locations_code ON warehouse_locations(code);
CREATE INDEX IF NOT EXISTS idx_locations_zone ON warehouse_locations(zone);

-- ============================================================
-- 10. SKU LOCATION MAPPINGS (Current Stock Location)
-- ============================================================

CREATE TABLE IF NOT EXISTS sku_location_mappings (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku_id       UUID NOT NULL UNIQUE REFERENCES skus(id) ON DELETE CASCADE,
  location_id  UUID NOT NULL REFERENCES warehouse_locations(id) ON DELETE RESTRICT,
  quantity     INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  notes        TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_sku_location_sku ON sku_location_mappings(sku_id);
CREATE INDEX IF NOT EXISTS idx_sku_location_location ON sku_location_mappings(location_id);

-- ============================================================
-- 11. ORDERS (Mirrored from Amazon SP-API)
-- ============================================================

CREATE TABLE IF NOT EXISTS orders (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  amazon_order_id         TEXT NOT NULL UNIQUE,        -- e.g. 403-1234567-1234567
  status                  order_status NOT NULL DEFAULT 'PENDING',
  purchase_date           TIMESTAMPTZ,
  last_update_date        TIMESTAMPTZ,
  fulfillment_channel     TEXT,                        -- MFN, AFN, Easy Ship
  sales_channel           TEXT,
  order_channel           TEXT,
  ship_service_level      TEXT,
  is_business_order       BOOLEAN NOT NULL DEFAULT false,
  is_prime                BOOLEAN NOT NULL DEFAULT false,
  is_replacement_order    BOOLEAN NOT NULL DEFAULT false,
  buyer_name              TEXT,
  buyer_email             TEXT,
  ship_city               TEXT,
  ship_state              TEXT,
  ship_postal_code        TEXT,
  ship_country            TEXT,
  order_total_amount      NUMERIC(10,2),
  order_total_currency    TEXT,
  number_of_items_shipped INTEGER NOT NULL DEFAULT 0,
  number_of_items_unshipped INTEGER NOT NULL DEFAULT 0,
  cancelled_at            TIMESTAMPTZ,
  packed_at               TIMESTAMPTZ,
  packed_by               UUID REFERENCES profiles(id),
  amazon_raw              JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_amazon_id ON orders(amazon_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_purchase_date ON orders(purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_packed_at ON orders(packed_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_updated_at ON orders(updated_at DESC);

-- ============================================================
-- 12. ORDER ITEMS
-- ============================================================

CREATE TABLE IF NOT EXISTS order_items (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id              UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amazon_order_item_id  TEXT NOT NULL,
  sku_id                UUID REFERENCES skus(id),
  amazon_sku            TEXT,
  asin                  TEXT,
  title                 TEXT,
  quantity_ordered      INTEGER NOT NULL DEFAULT 1 CHECK (quantity_ordered > 0),
  quantity_shipped      INTEGER NOT NULL DEFAULT 0 CHECK (quantity_shipped >= 0),
  item_price_amount     NUMERIC(10,2),
  item_price_currency   TEXT,
  item_tax_amount       NUMERIC(10,2),
  condition_id          TEXT,
  condition_note        TEXT,
  amazon_raw            JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, amazon_order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_sku ON order_items(sku_id);
CREATE INDEX IF NOT EXISTS idx_order_items_asin ON order_items(asin);

-- ============================================================
-- 13. SHIPMENTS (Easy Ship + MFN Shipment Data)
-- ============================================================

CREATE TABLE IF NOT EXISTS shipments (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id              UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amazon_shipment_id    TEXT UNIQUE,
  awb_number            TEXT UNIQUE,         -- Air Waybill barcode scanned by operator
  tracking_number       TEXT,
  carrier               TEXT,
  ship_method           TEXT,
  scheduled_pickup_date TIMESTAMPTZ,
  label_url             TEXT,               -- URL in Supabase Storage or Amazon
  label_format          TEXT,              -- PDF, ZPL, PNG
  shipment_status       TEXT,
  amazon_raw            JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_awb ON shipments(awb_number);
CREATE INDEX IF NOT EXISTS idx_shipments_amazon_id ON shipments(amazon_shipment_id);

-- ============================================================
-- 14. PACKING SESSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS packing_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  packer_id       UUID NOT NULL REFERENCES profiles(id),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  orders_packed   INTEGER NOT NULL DEFAULT 0,
  units_packed    INTEGER NOT NULL DEFAULT 0,
  cancelled_count INTEGER NOT NULL DEFAULT 0,
  invalid_scans   INTEGER NOT NULL DEFAULT 0,
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_packing_sessions_packer ON packing_sessions(packer_id);
CREATE INDEX IF NOT EXISTS idx_packing_sessions_started ON packing_sessions(started_at DESC);

-- ============================================================
-- 15. PACKING EVENTS (Immutable log of physical packing actions)
-- ============================================================

CREATE TABLE IF NOT EXISTS packing_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  session_id    UUID REFERENCES packing_sessions(id),
  packed_by     UUID NOT NULL REFERENCES profiles(id),
  awb_scanned   TEXT,
  event_type    packing_event_type NOT NULL DEFAULT 'SHIPPED_BY_MYSELF',
  packed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_info   TEXT,
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_packing_events_order ON packing_events(order_id);
CREATE INDEX IF NOT EXISTS idx_packing_events_packer ON packing_events(packed_by);
CREATE INDEX IF NOT EXISTS idx_packing_events_packed_at ON packing_events(packed_at DESC);
CREATE INDEX IF NOT EXISTS idx_packing_events_session ON packing_events(session_id);

-- ============================================================
-- 16. PUTAWAY EVENTS (Immutable log of location assignments)
-- ============================================================

CREATE TABLE IF NOT EXISTS putaway_events (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku_id           UUID NOT NULL REFERENCES skus(id),
  from_location_id UUID REFERENCES warehouse_locations(id),
  to_location_id   UUID NOT NULL REFERENCES warehouse_locations(id),
  action           putaway_action NOT NULL DEFAULT 'ASSIGNED',
  quantity         INTEGER,
  put_by           UUID NOT NULL REFERENCES profiles(id),
  put_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes            TEXT
);

CREATE INDEX IF NOT EXISTS idx_putaway_events_sku ON putaway_events(sku_id);
CREATE INDEX IF NOT EXISTS idx_putaway_events_put_at ON putaway_events(put_at DESC);
CREATE INDEX IF NOT EXISTS idx_putaway_events_put_by ON putaway_events(put_by);

-- ============================================================
-- 17. AUDIT LOGS
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name  TEXT NOT NULL,
  record_id   UUID,
  action      TEXT NOT NULL,
  actor_id    UUID REFERENCES profiles(id),
  old_data    JSONB,
  new_data    JSONB,
  metadata    JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_record ON audit_logs(record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- ============================================================
-- 18. SYNCHRONIZATION RUNS
-- ============================================================

CREATE TABLE IF NOT EXISTS sync_runs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status                sync_status NOT NULL DEFAULT 'RUNNING',
  triggered_by          UUID REFERENCES profiles(id),
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  duration_ms           INTEGER,
  orders_scanned        INTEGER NOT NULL DEFAULT 0,
  orders_created        INTEGER NOT NULL DEFAULT 0,
  orders_updated        INTEGER NOT NULL DEFAULT 0,
  orders_cancelled      INTEGER NOT NULL DEFAULT 0,
  items_synced          INTEGER NOT NULL DEFAULT 0,
  shipments_synced      INTEGER NOT NULL DEFAULT 0,
  error_count           INTEGER NOT NULL DEFAULT 0,
  last_order_date       TIMESTAMPTZ,
  error_message         TEXT,
  metadata              JSONB
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_runs_status ON sync_runs(status);

-- ============================================================
-- 19. SYNC ERRORS
-- ============================================================

CREATE TABLE IF NOT EXISTS sync_errors (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sync_run_id     UUID NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  amazon_order_id TEXT,
  error_code      TEXT,
  error_message   TEXT NOT NULL,
  raw_data        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_errors_run ON sync_errors(sync_run_id);
CREATE INDEX IF NOT EXISTS idx_sync_errors_order ON sync_errors(amazon_order_id);

-- ============================================================
-- 20. TRIGGERS — Auto Maintenance for updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'products', 'skus', 'barcode_mappings',
    'warehouse_locations', 'sku_location_mappings',
    'orders', 'order_items', 'shipments'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = format('trg_%s_updated_at', t)
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER trg_%I_updated_at
         BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
        t, t
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 21. TRIGGER — Auto Create Profile on Auth Signup
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, display_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'PACKER')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION handle_new_user();
  END IF;
END $$;

-- ============================================================
-- 22. AUTHORIZATION HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog;

CREATE OR REPLACE FUNCTION has_role(required_role user_role)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = required_role
      AND is_active = true
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT has_role('ADMIN')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog;

CREATE OR REPLACE FUNCTION is_packer_or_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role IN ('ADMIN', 'PACKER')
      AND is_active = true
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog;

CREATE OR REPLACE FUNCTION is_putaway_or_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role IN ('ADMIN', 'PUTAWAY')
      AND is_active = true
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog;

CREATE OR REPLACE FUNCTION is_authenticated_and_active()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND is_active = true
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog;

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

-- ============================================================
-- 23. ATOMIC OPERATIONAL FUNCTIONS / RPCs
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
    RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_FOUND', 'message', 'Order not found: ' || p_amazon_order_id);
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

  -- Fallback search directly on orders table ONLY if input matches exact Amazon Order ID pattern (e.g. 403-1234567-1234567)
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

-- ============================================================
-- 24. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE barcode_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sku_location_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE packing_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE packing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE putaway_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_errors ENABLE ROW LEVEL SECURITY;

-- PROFILES
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT USING (id = auth.uid() OR is_admin());
DROP POLICY IF EXISTS profiles_update_own ON profiles;
CREATE POLICY profiles_update_own ON profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid() AND role = (SELECT role FROM profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS profiles_admin_update ON profiles;
CREATE POLICY profiles_admin_update ON profiles FOR UPDATE USING (is_admin());
DROP POLICY IF EXISTS profiles_admin_insert ON profiles;
CREATE POLICY profiles_admin_insert ON profiles FOR INSERT WITH CHECK (is_admin());

-- SYSTEM SETTINGS (RESTRICT SENSITIVE CREDENTIAL KEYS TO ADMIN ONLY)
DROP POLICY IF EXISTS system_settings_select ON system_settings;
CREATE POLICY system_settings_select ON system_settings FOR SELECT
  USING (
    (is_authenticated_and_active() AND key NOT IN ('amazon_client_secret', 'amazon_refresh_token', 'amazon_client_id', 'amazon_seller_id'))
    OR is_admin()
  );

DROP POLICY IF EXISTS system_settings_admin_write ON system_settings;
CREATE POLICY system_settings_admin_write ON system_settings FOR ALL USING (is_admin());

-- PRODUCTS
DROP POLICY IF EXISTS products_select ON products;
CREATE POLICY products_select ON products FOR SELECT USING (is_authenticated_and_active());
DROP POLICY IF EXISTS products_admin_write ON products;
CREATE POLICY products_admin_write ON products FOR ALL USING (is_admin());

-- PRODUCT IMAGES
DROP POLICY IF EXISTS product_images_select ON product_images;
CREATE POLICY product_images_select ON product_images FOR SELECT USING (is_authenticated_and_active());
DROP POLICY IF EXISTS product_images_admin_write ON product_images;
CREATE POLICY product_images_admin_write ON product_images FOR ALL USING (is_admin());

-- SKUs
DROP POLICY IF EXISTS skus_select ON skus;
CREATE POLICY skus_select ON skus FOR SELECT USING (is_authenticated_and_active());
DROP POLICY IF EXISTS skus_admin_write ON skus;
CREATE POLICY skus_admin_write ON skus FOR ALL USING (is_admin());

-- BARCODE MAPPINGS
DROP POLICY IF EXISTS barcode_select ON barcode_mappings;
CREATE POLICY barcode_select ON barcode_mappings FOR SELECT USING (is_authenticated_and_active());
DROP POLICY IF EXISTS barcode_admin_write ON barcode_mappings;
CREATE POLICY barcode_admin_write ON barcode_mappings FOR ALL USING (is_admin());

-- WAREHOUSE LOCATIONS
DROP POLICY IF EXISTS locations_select ON warehouse_locations;
CREATE POLICY locations_select ON warehouse_locations FOR SELECT USING (is_authenticated_and_active());
DROP POLICY IF EXISTS locations_admin_write ON warehouse_locations;
CREATE POLICY locations_admin_write ON warehouse_locations FOR ALL USING (is_admin());

-- SKU LOCATION MAPPINGS
DROP POLICY IF EXISTS sku_location_select ON sku_location_mappings;
CREATE POLICY sku_location_select ON sku_location_mappings FOR SELECT USING (is_authenticated_and_active());
DROP POLICY IF EXISTS sku_location_putaway_write ON sku_location_mappings;
CREATE POLICY sku_location_putaway_write ON sku_location_mappings FOR INSERT WITH CHECK (is_putaway_or_admin());
DROP POLICY IF EXISTS sku_location_putaway_update ON sku_location_mappings;
CREATE POLICY sku_location_putaway_update ON sku_location_mappings FOR UPDATE USING (is_putaway_or_admin());
DROP POLICY IF EXISTS sku_location_admin_delete ON sku_location_mappings;
CREATE POLICY sku_location_admin_delete ON sku_location_mappings FOR DELETE USING (is_admin());

-- ORDERS (Direct client writes blocked; updates via Edge Function service role only)
DROP POLICY IF EXISTS orders_select ON orders;
CREATE POLICY orders_select ON orders FOR SELECT USING (is_authenticated_and_active());
DROP POLICY IF EXISTS orders_admin_write ON orders;
CREATE POLICY orders_admin_write ON orders FOR ALL USING (is_admin());

-- ORDER ITEMS
DROP POLICY IF EXISTS order_items_select ON order_items;
CREATE POLICY order_items_select ON order_items FOR SELECT USING (is_authenticated_and_active());
DROP POLICY IF EXISTS order_items_admin_write ON order_items;
CREATE POLICY order_items_admin_write ON order_items FOR ALL USING (is_admin());

-- SHIPMENTS
DROP POLICY IF EXISTS shipments_select ON shipments;
CREATE POLICY shipments_select ON shipments FOR SELECT USING (is_authenticated_and_active());
DROP POLICY IF EXISTS shipments_admin_write ON shipments;
CREATE POLICY shipments_admin_write ON shipments FOR ALL USING (is_admin());

-- PACKING SESSIONS
DROP POLICY IF EXISTS packing_sessions_select ON packing_sessions;
CREATE POLICY packing_sessions_select ON packing_sessions FOR SELECT USING (packer_id = auth.uid() OR is_admin());
DROP POLICY IF EXISTS packing_sessions_insert ON packing_sessions;
CREATE POLICY packing_sessions_insert ON packing_sessions FOR INSERT WITH CHECK (packer_id = auth.uid() AND is_packer_or_admin());
DROP POLICY IF EXISTS packing_sessions_update ON packing_sessions;
CREATE POLICY packing_sessions_update ON packing_sessions FOR UPDATE USING (packer_id = auth.uid() OR is_admin());

-- PACKING EVENTS (Immutable Log — Direct client inserts blocked)
DROP POLICY IF EXISTS packing_events_select ON packing_events;
CREATE POLICY packing_events_select ON packing_events FOR SELECT USING (is_authenticated_and_active());
DROP POLICY IF EXISTS packing_events_no_direct_insert ON packing_events;
CREATE POLICY packing_events_no_direct_insert ON packing_events FOR INSERT WITH CHECK (false);

-- PUTAWAY EVENTS (Immutable Log — Direct deletes blocked)
DROP POLICY IF EXISTS putaway_events_select ON putaway_events;
CREATE POLICY putaway_events_select ON putaway_events FOR SELECT USING (is_authenticated_and_active());
DROP POLICY IF EXISTS putaway_events_insert ON putaway_events;
CREATE POLICY putaway_events_insert ON putaway_events FOR INSERT WITH CHECK (put_by = auth.uid() AND is_putaway_or_admin());
DROP POLICY IF EXISTS putaway_events_no_delete ON putaway_events;
CREATE POLICY putaway_events_no_delete ON putaway_events FOR DELETE USING (false);

-- AUDIT LOGS (Direct client writes blocked)
DROP POLICY IF EXISTS audit_logs_select ON audit_logs;
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS audit_logs_no_client_write ON audit_logs;
CREATE POLICY audit_logs_no_client_write ON audit_logs FOR INSERT WITH CHECK (false);

-- SYNC RUNS & ERRORS
DROP POLICY IF EXISTS sync_runs_select ON sync_runs;
CREATE POLICY sync_runs_select ON sync_runs FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS sync_runs_no_client_write ON sync_runs;
CREATE POLICY sync_runs_no_client_write ON sync_runs FOR ALL USING (is_admin());
DROP POLICY IF EXISTS sync_errors_select ON sync_errors;
CREATE POLICY sync_errors_select ON sync_errors FOR SELECT USING (is_admin());

-- ============================================================
-- 25. NON-DESTRUCTIVE REALTIME PUBLICATION CONFIGURATION
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'orders', 'order_items', 'shipments', 'packing_events',
    'sku_location_mappings', 'sync_runs', 'packing_sessions'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 26. SEED NON-SENSITIVE SYSTEM SETTINGS ONLY
-- ============================================================

INSERT INTO system_settings (key, value, description) VALUES
  ('amazon_marketplace_id', 'A21TJRUUN4KGV', 'Amazon India Marketplace ID'),
  ('amazon_region', 'eu-west-1', 'Amazon SP-API region endpoint'),
  ('sync_lookback_hours', '48', 'Hours to look back when syncing orders'),
  ('sync_interval_minutes', '15', 'Auto-sync interval in minutes'),
  ('last_sync_at', '', 'Timestamp of last successful Amazon sync'),
  ('packing_session_timeout_minutes', '480', 'Auto-end session after N minutes'),
  ('app_version', '1.0.0', 'Application version')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description;

-- ============================================================
-- REYO PACK AIO SCHEMA GENERATION COMPLETE
-- ============================================================
