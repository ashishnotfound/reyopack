// src/types/database.types.ts
// TypeScript types matching the Supabase PostgreSQL schema

export type UserRole = 'ADMIN' | 'PACKER' | 'PUTAWAY' | 'VIEWER';
export type OrderStatus = 'PENDING' | 'PACKED' | 'SHIPPED' | 'CANCELLED' | 'RETURNED' | 'UNSHIPPED' | 'CHECKING';
export type SyncStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'PARTIAL';
export type PutawayAction = 'ASSIGNED' | 'MOVED' | 'CLEARED';

export interface Profile {
  id: string;
  full_name: string;
  display_name: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SystemSetting {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface Product {
  id: string;
  title: string;
  brand: string | null;
  category: string | null;
  description: string | null;
  image_url: string | null;
  weight_grams: number | null;
  dimensions_json: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Sku {
  id: string;
  product_id: string | null;
  amazon_sku: string;
  asin: string | null;
  fnsku: string | null;
  seller_sku: string | null;
  title: string | null;
  quantity_per_pack: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Joined
  product?: Product | null;
}

export interface BarcodeMapping {
  id: string;
  barcode: string;
  sku_id: string;
  barcode_type: string;
  is_primary: boolean;
  created_at: string;
  // Joined
  sku?: Sku | null;
}

export interface WarehouseLocation {
  id: string;
  code: string;
  zone: string | null;
  aisle: string | null;
  shelf: string | null;
  bin: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SkuLocationMapping {
  id: string;
  sku_id: string;
  location_id: string;
  quantity: number;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
  // Joined
  sku?: Sku | null;
  location?: WarehouseLocation | null;
}

export interface Order {
  id: string;
  amazon_order_id: string;
  status: OrderStatus;
  purchase_date: string | null;
  last_update_date: string | null;
  fulfillment_channel: string | null;
  sales_channel: string | null;
  order_channel: string | null;
  ship_service_level: string | null;
  is_business_order: boolean;
  is_prime: boolean;
  is_replacement_order: boolean;
  buyer_name: string | null;
  buyer_email: string | null;
  ship_city: string | null;
  ship_state: string | null;
  ship_postal_code: string | null;
  ship_country: string | null;
  order_total_amount: number | null;
  order_total_currency: string | null;
  number_of_items_shipped: number;
  number_of_items_unshipped: number;
  cancelled_at: string | null;
  packed_at: string | null;
  packed_by: string | null;
  amazon_raw: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  // Joined
  order_items?: OrderItem[];
  shipments?: Shipment[];
  packing_event?: PackingEvent | null;
  packer?: Profile | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  amazon_order_item_id: string;
  sku_id: string | null;
  amazon_sku: string | null;
  asin: string | null;
  title: string | null;
  quantity_ordered: number;
  quantity_shipped: number;
  item_price_amount: number | null;
  item_price_currency: string | null;
  item_tax_amount: number | null;
  condition_id: string | null;
  condition_note: string | null;
  amazon_raw: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  // Joined
  sku?: Sku | null;
}

export interface Shipment {
  id: string;
  order_id: string;
  amazon_shipment_id: string | null;
  awb_number: string | null;
  tracking_number: string | null;
  carrier: string | null;
  ship_method: string | null;
  scheduled_pickup_date: string | null;
  label_url: string | null;
  label_format: string | null;
  shipment_status: string | null;
  amazon_raw: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface PackingSession {
  id: string;
  packer_id: string;
  started_at: string;
  ended_at: string | null;
  orders_packed: number;
  notes: string | null;
  // Joined
  packer?: Profile | null;
}

export interface PackingEvent {
  id: string;
  order_id: string;
  session_id: string | null;
  packed_by: string;
  awb_scanned: string | null;
  packed_at: string;
  device_info: string | null;
  notes: string | null;
  // Joined
  order?: Order | null;
  packer?: Profile | null;
}

export interface PutawayEvent {
  id: string;
  sku_id: string;
  from_location_id: string | null;
  to_location_id: string;
  action: PutawayAction;
  quantity: number | null;
  put_by: string;
  put_at: string;
  notes: string | null;
  // Joined
  sku?: Sku | null;
  from_location?: WarehouseLocation | null;
  to_location?: WarehouseLocation | null;
  putter?: Profile | null;
}

export interface AuditLog {
  id: string;
  table_name: string;
  record_id: string | null;
  action: string;
  actor_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
  // Joined
  actor?: Profile | null;
}

export interface SyncRun {
  id: string;
  status: SyncStatus;
  triggered_by: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  orders_scanned: number;
  orders_created: number;
  orders_updated: number;
  orders_cancelled: number;
  items_synced: number;
  shipments_synced: number;
  error_count: number;
  last_order_date: string | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  // Joined
  triggerer?: Profile | null;
}

export interface SyncError {
  id: string;
  sync_run_id: string;
  amazon_order_id: string | null;
  error_code: string | null;
  error_message: string;
  raw_data: Record<string, unknown> | null;
  created_at: string;
}

// ============================================================
// API response types
// ============================================================

export interface PackOrderResult {
  success: boolean;
  code: 'PACKED' | 'ORDER_NOT_FOUND' | 'ORDER_CANCELLED' | 'ALREADY_PACKED' | 'ALREADY_PROCESSED' | 'CHECKING_RECORDED' | 'SHIPPED_SUCCESSFULLY' | 'LOCK_CONFLICT';
  message: string;
  order_id?: string;
  amazon_order_id?: string;
  packing_event_id?: string;
  packed_at?: string;
  packed_by?: string;
}

export interface AwbLookupResult {
  found: boolean;
  order_id?: string;
  amazon_order_id?: string;
  status?: OrderStatus;
  is_prime?: boolean;
  purchase_date?: string;
  packed_at?: string;
  packed_by?: string;
  packed_by_name?: string;
  buyer_name?: string;
  ship_city?: string;
  ship_state?: string;
  awb?: string;
  carrier?: string;
  label_url?: string;
  resolved_by?: 'AWB_EXACT' | 'AMAZON_ORDER_ID';
  last_event?: {
    event_type: 'SCANNED' | 'CHECKING' | 'SHIPPED_BY_MYSELF' | 'PACKED' | 'CANCELLED';
    packed_at: string;
    packer_name?: string;
    session_id?: string;
  };
  items?: Array<{
    order_item_id: string;
    asin: string | null;
    amazon_sku: string | null;
    title: string | null;
    quantity_ordered: number;
    quantity_shipped: number;
    sku_id: string | null;
    location: string | null;
    image_url?: string | null;
  }>;
  message?: string;
}

// Supabase DB type for typed client
export type Database = {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> };
      system_settings: { Row: SystemSetting; Insert: Partial<SystemSetting>; Update: Partial<SystemSetting> };
      products: { Row: Product; Insert: Partial<Product>; Update: Partial<Product> };
      skus: { Row: Sku; Insert: Partial<Sku>; Update: Partial<Sku> };
      barcode_mappings: { Row: BarcodeMapping; Insert: Partial<BarcodeMapping>; Update: Partial<BarcodeMapping> };
      warehouse_locations: { Row: WarehouseLocation; Insert: Partial<WarehouseLocation>; Update: Partial<WarehouseLocation> };
      sku_location_mappings: { Row: SkuLocationMapping; Insert: Partial<SkuLocationMapping>; Update: Partial<SkuLocationMapping> };
      orders: { Row: Order; Insert: Partial<Order>; Update: Partial<Order> };
      order_items: { Row: OrderItem; Insert: Partial<OrderItem>; Update: Partial<OrderItem> };
      shipments: { Row: Shipment; Insert: Partial<Shipment>; Update: Partial<Shipment> };
      packing_sessions: { Row: PackingSession; Insert: Partial<PackingSession>; Update: Partial<PackingSession> };
      packing_events: { Row: PackingEvent; Insert: Partial<PackingEvent>; Update: Partial<PackingEvent> };
      putaway_events: { Row: PutawayEvent; Insert: Partial<PutawayEvent>; Update: Partial<PutawayEvent> };
      audit_logs: { Row: AuditLog; Insert: Partial<AuditLog>; Update: Partial<AuditLog> };
      sync_runs: { Row: SyncRun; Insert: Partial<SyncRun>; Update: Partial<SyncRun> };
      sync_errors: { Row: SyncError; Insert: Partial<SyncError>; Update: Partial<SyncError> };
    };
    Functions: {
      atomic_pack_order: {
        Args: {
          p_amazon_order_id: string;
          p_packer_id: string;
          p_session_id?: string;
          p_awb_scanned?: string;
          p_device_info?: string;
        };
        Returns: PackOrderResult;
      };
      lookup_order_by_awb: {
        Args: { p_awb: string };
        Returns: AwbLookupResult;
      };
      upsert_sku_location: {
        Args: {
          p_sku_id: string;
          p_location_id: string;
          p_quantity?: number;
          p_put_by?: string;
          p_notes?: string;
        };
        Returns: { success: boolean; sku_id: string; location_id: string; old_location_id: string };
      };
    };
    Enums: {
      user_role: UserRole;
      order_status: OrderStatus;
      sync_status: SyncStatus;
      putaway_action: PutawayAction;
    };
  };
};
