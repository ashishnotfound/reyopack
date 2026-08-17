-- ============================================================
-- REYO PACK — ROW LEVEL SECURITY POLICIES
-- Migration: 002_rls.sql
-- ============================================================

-- ============================================================
-- Helper function: get current user's role
-- ============================================================

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- Helper function: check if current user has role
-- ============================================================

CREATE OR REPLACE FUNCTION has_role(required_role user_role)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = required_role
      AND is_active = true
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT has_role('ADMIN')
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_packer_or_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role IN ('ADMIN', 'PACKER')
      AND is_active = true
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_putaway_or_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role IN ('ADMIN', 'PUTAWAY')
      AND is_active = true
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_authenticated_and_active()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND is_active = true
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- Enable RLS on all tables
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
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

-- ============================================================
-- PROFILES — RLS
-- ============================================================

-- Users can read their own profile; admins can read all
CREATE POLICY profiles_select ON profiles FOR SELECT
  USING (id = auth.uid() OR is_admin());

-- Users can update their own profile (name/display_name only); admin can update all
CREATE POLICY profiles_update_own ON profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = (SELECT role FROM profiles WHERE id = auth.uid()));

CREATE POLICY profiles_admin_update ON profiles FOR UPDATE
  USING (is_admin());

CREATE POLICY profiles_admin_insert ON profiles FOR INSERT
  WITH CHECK (is_admin());

-- ============================================================
-- SYSTEM SETTINGS — RLS
-- ============================================================
-- Purge legacy plaintext secrets if present in database
DELETE FROM system_settings
WHERE key IN ('amazon_client_secret', 'amazon_refresh_token', 'amazon_client_id', 'amazon_seller_id');

-- SYSTEM SETTINGS — RLS
-- All active authenticated users can read public settings; only admins can read sensitive credential keys
CREATE POLICY system_settings_select ON system_settings FOR SELECT
  USING (
    (is_authenticated_and_active() AND key NOT IN ('amazon_client_secret', 'amazon_refresh_token', 'amazon_client_id', 'amazon_seller_id'))
    OR is_admin()
  );

-- Only admins can modify settings
CREATE POLICY system_settings_admin_write ON system_settings FOR ALL
  USING (is_admin());

-- ============================================================
-- PRODUCTS — RLS
-- ============================================================

CREATE POLICY products_select ON products FOR SELECT
  USING (is_authenticated_and_active());

CREATE POLICY products_admin_write ON products FOR ALL
  USING (is_admin());

-- ============================================================
-- SKUs — RLS
-- ============================================================

CREATE POLICY skus_select ON skus FOR SELECT
  USING (is_authenticated_and_active());

CREATE POLICY skus_admin_write ON skus FOR ALL
  USING (is_admin());

-- ============================================================
-- BARCODE MAPPINGS — RLS
-- ============================================================

CREATE POLICY barcode_select ON barcode_mappings FOR SELECT
  USING (is_authenticated_and_active());

CREATE POLICY barcode_admin_write ON barcode_mappings FOR ALL
  USING (is_admin());

-- ============================================================
-- WAREHOUSE LOCATIONS — RLS
-- ============================================================

CREATE POLICY locations_select ON warehouse_locations FOR SELECT
  USING (is_authenticated_and_active());

CREATE POLICY locations_admin_write ON warehouse_locations FOR ALL
  USING (is_admin());

-- ============================================================
-- SKU LOCATION MAPPINGS — RLS
-- ============================================================

-- All active users can read locations (putaway and packers need this)
CREATE POLICY sku_location_select ON sku_location_mappings FOR SELECT
  USING (is_authenticated_and_active());

-- Putaway role + admin can update
CREATE POLICY sku_location_putaway_write ON sku_location_mappings FOR INSERT
  WITH CHECK (is_putaway_or_admin());

CREATE POLICY sku_location_putaway_update ON sku_location_mappings FOR UPDATE
  USING (is_putaway_or_admin());

CREATE POLICY sku_location_admin_delete ON sku_location_mappings FOR DELETE
  USING (is_admin());

-- ============================================================
-- ORDERS — RLS
-- ============================================================

CREATE POLICY orders_select ON orders FOR SELECT
  USING (is_authenticated_and_active());

-- Only edge functions (service role) can insert/update orders
-- Packers can update packed_at/packed_by via pack-order edge function only
-- No direct client-side writes to orders
CREATE POLICY orders_admin_write ON orders FOR ALL
  USING (is_admin());

-- ============================================================
-- ORDER ITEMS — RLS
-- ============================================================

CREATE POLICY order_items_select ON order_items FOR SELECT
  USING (is_authenticated_and_active());

CREATE POLICY order_items_admin_write ON order_items FOR ALL
  USING (is_admin());

-- ============================================================
-- SHIPMENTS — RLS
-- ============================================================

CREATE POLICY shipments_select ON shipments FOR SELECT
  USING (is_authenticated_and_active());

CREATE POLICY shipments_admin_write ON shipments FOR ALL
  USING (is_admin());

-- ============================================================
-- PACKING SESSIONS — RLS
-- ============================================================

-- Packers see their own sessions; admins see all
CREATE POLICY packing_sessions_select ON packing_sessions FOR SELECT
  USING (packer_id = auth.uid() OR is_admin());

-- Packers and admins can insert (start a session)
CREATE POLICY packing_sessions_insert ON packing_sessions FOR INSERT
  WITH CHECK (packer_id = auth.uid() AND is_packer_or_admin());

-- Only end own session or admin ends any
CREATE POLICY packing_sessions_update ON packing_sessions FOR UPDATE
  USING (packer_id = auth.uid() OR is_admin());

-- ============================================================
-- PACKING EVENTS — RLS
-- ============================================================

-- All active users can read packing events (history/queue)
CREATE POLICY packing_events_select ON packing_events FOR SELECT
  USING (is_authenticated_and_active());

-- Only edge function (service role) inserts packing events — no direct client insert
-- This prevents bypassing the atomic pack-order edge function
CREATE POLICY packing_events_no_direct_insert ON packing_events FOR INSERT
  WITH CHECK (false);  -- Block all direct client inserts

-- ============================================================
-- PUTAWAY EVENTS — RLS
-- ============================================================

CREATE POLICY putaway_events_select ON putaway_events FOR SELECT
  USING (is_authenticated_and_active());

-- Putaway workers can log their own events
CREATE POLICY putaway_events_insert ON putaway_events FOR INSERT
  WITH CHECK (put_by = auth.uid() AND is_putaway_or_admin());

-- No updates or deletes to putaway events (strictly immutable log)
CREATE POLICY putaway_events_no_delete ON putaway_events FOR DELETE
  USING (false);

-- ============================================================
-- AUDIT LOGS — RLS
-- ============================================================

CREATE POLICY audit_logs_select ON audit_logs FOR SELECT
  USING (is_admin());

-- Only service role can write audit logs
CREATE POLICY audit_logs_no_client_write ON audit_logs FOR INSERT
  WITH CHECK (false);

-- ============================================================
-- SYNC RUNS — RLS
-- ============================================================

CREATE POLICY sync_runs_select ON sync_runs FOR SELECT
  USING (is_admin());

CREATE POLICY sync_runs_no_client_write ON sync_runs FOR ALL
  USING (is_admin());

-- ============================================================
-- SYNC ERRORS — RLS
-- ============================================================

CREATE POLICY sync_errors_select ON sync_errors FOR SELECT
  USING (is_admin());

-- ============================================================
-- REALTIME — enable publication for critical tables
-- ============================================================

BEGIN;
  -- Drop existing publication if exists
  DROP PUBLICATION IF EXISTS supabase_realtime;
  
  -- Recreate with tables that need realtime
  CREATE PUBLICATION supabase_realtime FOR TABLE
    orders,
    order_items,
    shipments,
    packing_events,
    sku_location_mappings,
    sync_runs,
    packing_sessions;
COMMIT;
