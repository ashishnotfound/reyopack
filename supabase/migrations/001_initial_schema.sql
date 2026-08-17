-- ============================================================
-- REYO PACK — INITIAL SCHEMA MIGRATION
-- Migration: 001_initial_schema.sql
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- ============================================================
-- ROLES ENUM
-- ============================================================

CREATE TYPE user_role AS ENUM ('ADMIN', 'PACKER', 'PUTAWAY', 'VIEWER');
CREATE TYPE order_status AS ENUM (
  'PENDING', 'PACKED', 'SHIPPED', 'CANCELLED', 'RETURNED', 'UNSHIPPED'
);
CREATE TYPE sync_status AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL');
CREATE TYPE putaway_action AS ENUM ('ASSIGNED', 'MOVED', 'CLEARED');

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================

CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  display_name  TEXT,
  role          user_role NOT NULL DEFAULT 'PACKER',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_active ON profiles(is_active);

-- ============================================================
-- SYSTEM SETTINGS
-- ============================================================

CREATE TABLE system_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES profiles(id)
);

-- ============================================================
-- PRODUCTS
-- ============================================================

CREATE TABLE products (
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

CREATE INDEX idx_products_active ON products(is_active);

-- ============================================================
-- SKUs
-- ============================================================

CREATE TABLE skus (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id      UUID REFERENCES products(id) ON DELETE SET NULL,
  amazon_sku      TEXT NOT NULL UNIQUE,
  asin            TEXT,
  fnsku           TEXT,
  seller_sku      TEXT,
  title           TEXT,                 -- fallback if no product
  quantity_per_pack INTEGER NOT NULL DEFAULT 1,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_skus_amazon_sku ON skus(amazon_sku);
CREATE INDEX idx_skus_asin ON skus(asin);
CREATE INDEX idx_skus_fnsku ON skus(fnsku);
CREATE INDEX idx_skus_product ON skus(product_id);

-- ============================================================
-- BARCODE MAPPINGS
-- ============================================================

CREATE TABLE barcode_mappings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  barcode     TEXT NOT NULL UNIQUE,
  sku_id      UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  barcode_type TEXT NOT NULL DEFAULT 'EAN13',  -- EAN13, UPC, QR, CODE128, FNSKU
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_barcode_mappings_barcode ON barcode_mappings(barcode);
CREATE INDEX idx_barcode_mappings_sku ON barcode_mappings(sku_id);

-- ============================================================
-- WAREHOUSE LOCATIONS
-- ============================================================

CREATE TABLE warehouse_locations (
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

CREATE INDEX idx_locations_code ON warehouse_locations(code);
CREATE INDEX idx_locations_zone ON warehouse_locations(zone);

-- ============================================================
-- SKU LOCATION MAPPINGS (current location state)
-- ============================================================

CREATE TABLE sku_location_mappings (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku_id       UUID NOT NULL UNIQUE REFERENCES skus(id) ON DELETE CASCADE,
  location_id  UUID NOT NULL REFERENCES warehouse_locations(id) ON DELETE RESTRICT,
  quantity     INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  notes        TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID REFERENCES profiles(id)
);

CREATE INDEX idx_sku_location_sku ON sku_location_mappings(sku_id);
CREATE INDEX idx_sku_location_location ON sku_location_mappings(location_id);

-- ============================================================
-- ORDERS (mirrored from Amazon SP-API)
-- ============================================================

CREATE TABLE orders (
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
  amazon_raw              JSONB,                       -- raw SP-API order object
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_amazon_id ON orders(amazon_order_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_purchase_date ON orders(purchase_date DESC);
CREATE INDEX idx_orders_packed_at ON orders(packed_at DESC);
CREATE INDEX idx_orders_updated_at ON orders(updated_at DESC);

-- ============================================================
-- ORDER ITEMS
-- ============================================================

CREATE TABLE order_items (
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

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_sku ON order_items(sku_id);
CREATE INDEX idx_order_items_asin ON order_items(asin);

-- ============================================================
-- SHIPMENTS (Easy Ship + MFN shipment data)
-- ============================================================

CREATE TABLE shipments (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id              UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amazon_shipment_id    TEXT UNIQUE,
  awb_number            TEXT UNIQUE,         -- Air Waybill — the barcode we scan
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

CREATE INDEX idx_shipments_order ON shipments(order_id);
CREATE INDEX idx_shipments_awb ON shipments(awb_number);
CREATE INDEX idx_shipments_amazon_id ON shipments(amazon_shipment_id);

-- ============================================================
-- PACKING SESSIONS
-- ============================================================

CREATE TABLE packing_sessions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  packer_id     UUID NOT NULL REFERENCES profiles(id),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  orders_packed INTEGER NOT NULL DEFAULT 0,
  notes         TEXT
);

CREATE INDEX idx_packing_sessions_packer ON packing_sessions(packer_id);
CREATE INDEX idx_packing_sessions_started ON packing_sessions(started_at DESC);

-- ============================================================
-- PACKING EVENTS (immutable record of each pack action)
-- ============================================================

CREATE TABLE packing_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,  -- UNIQUE prevents duplication
  session_id    UUID REFERENCES packing_sessions(id),
  packed_by     UUID NOT NULL REFERENCES profiles(id),
  awb_scanned   TEXT,
  packed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_info   TEXT,
  notes         TEXT
);

CREATE INDEX idx_packing_events_order ON packing_events(order_id);
CREATE INDEX idx_packing_events_packer ON packing_events(packed_by);
CREATE INDEX idx_packing_events_packed_at ON packing_events(packed_at DESC);
CREATE INDEX idx_packing_events_session ON packing_events(session_id);

-- ============================================================
-- PUTAWAY EVENTS (immutable log of every location assignment)
-- ============================================================

CREATE TABLE putaway_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku_id          UUID NOT NULL REFERENCES skus(id),
  from_location_id UUID REFERENCES warehouse_locations(id),
  to_location_id  UUID NOT NULL REFERENCES warehouse_locations(id),
  action          putaway_action NOT NULL DEFAULT 'ASSIGNED',
  quantity        INTEGER,
  put_by          UUID NOT NULL REFERENCES profiles(id),
  put_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes           TEXT
);

CREATE INDEX idx_putaway_events_sku ON putaway_events(sku_id);
CREATE INDEX idx_putaway_events_put_at ON putaway_events(put_at DESC);
CREATE INDEX idx_putaway_events_put_by ON putaway_events(put_by);

-- ============================================================
-- AUDIT LOGS
-- ============================================================

CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name  TEXT NOT NULL,
  record_id   UUID,
  action      TEXT NOT NULL,       -- INSERT, UPDATE, DELETE, CUSTOM
  actor_id    UUID REFERENCES profiles(id),
  old_data    JSONB,
  new_data    JSONB,
  metadata    JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_table ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_record ON audit_logs(record_id);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

-- ============================================================
-- SYNCHRONIZATION RUNS
-- ============================================================

CREATE TABLE sync_runs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status                sync_status NOT NULL DEFAULT 'RUNNING',
  triggered_by          UUID REFERENCES profiles(id),  -- NULL = scheduled
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

CREATE INDEX idx_sync_runs_started ON sync_runs(started_at DESC);
CREATE INDEX idx_sync_runs_status ON sync_runs(status);

-- ============================================================
-- SYNC ERRORS
-- ============================================================

CREATE TABLE sync_errors (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sync_run_id     UUID NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  amazon_order_id TEXT,
  error_code      TEXT,
  error_message   TEXT NOT NULL,
  raw_data        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_errors_run ON sync_errors(sync_run_id);
CREATE INDEX idx_sync_errors_order ON sync_errors(amazon_order_id);

-- ============================================================
-- TRIGGERS — updated_at auto-maintenance
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
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at
       BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t, t
    );
  END LOOP;
END;
$$;

-- ============================================================
-- TRIGGER — auto-create profile on auth.users signup
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
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- SEED INITIAL SYSTEM SETTINGS
-- ============================================================

INSERT INTO system_settings (key, value, description) VALUES
  ('amazon_marketplace_id', 'A21TJRUUN4KGV', 'Amazon India Marketplace ID'),
  ('amazon_region', 'eu-west-1', 'Amazon SP-API region'),
  ('sync_lookback_hours', '48', 'Hours to look back when syncing orders'),
  ('sync_interval_minutes', '15', 'Auto-sync interval in minutes'),
  ('last_sync_at', '', 'Timestamp of last successful Amazon sync'),
  ('packing_session_timeout_minutes', '480', 'Auto-end session after N minutes'),
  ('app_version', '1.0.0', 'Application version');
