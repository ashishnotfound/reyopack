# REYO PACK — PRODUCTION FULFILLMENT & PACKING SYSTEM

Reyo Pack is a production-ready internal warehouse fulfillment and packing application for Reyo Store built with **Next.js 14** and **Supabase** (PostgreSQL, Auth, Realtime, Edge Functions, Storage).

---

## ⚡ Architecture Overview

```
AMAZON SP-API (Easy Ship India)
        ↓
SUPABASE EDGE FUNCTIONS (Server-side LWA + SP-API, Secrets secured)
        ↓
SUPABASE POSTGRESQL (Central Source of Truth with RLS & Constraints)
        ↓
SUPABASE REALTIME (State Synchronization across all devices)
        ↓
┌───────────────────────┬───────────────────────┐
↓                       ↓                       ↓
PACKING APP (/scan)    ADMIN PANEL (/admin)    PUTAWAY (/putaway)
```

---

## 🔒 Security Requirements

- **Amazon SP-API credentials, client secrets, and refresh tokens NEVER reach the browser.**
- All SP-API requests run inside **Supabase Edge Functions**.
- Database tables are protected by **Row Level Security (RLS)** policies per role:
  - `ADMIN`: Full system control, SP-API sync trigger, catalog & user management
  - `PACKER`: Order packing, scan lookup, packing sessions
  - `PUTAWAY`: Location assignments & warehouse bin updates
  - `VIEWER`: Read-only access to queue & history
- Concurrency protection: `pack-order` Edge Function calls PostgreSQL `atomic_pack_order` which performs `SELECT FOR UPDATE` to prevent double-packing.

---

## 🚀 Setup & Deployment

### 1. Database Migrations

Apply the migration files in `supabase/migrations/` in order:

```bash
# Using Supabase CLI
supabase db push

# Or execute SQL files manually in Supabase SQL Editor:
# 1. 001_initial_schema.sql
# 2. 002_rls.sql
# 3. 003_functions.sql
```

### 2. Configure Supabase Edge Function Secrets

Set private Amazon SP-API and system credentials via Supabase Dashboard -> **Edge Functions** -> **Secrets**:

```bash
supabase secrets set AMAZON_CLIENT_ID="your-client-id"
supabase secrets set AMAZON_CLIENT_SECRET="your-client-secret"
supabase secrets set AMAZON_REFRESH_TOKEN="your-refresh-token"
supabase secrets set AMAZON_SELLER_ID="your-seller-id"
supabase secrets set AMAZON_MARKETPLACE_ID="A21TJRUUN4KGV"
supabase secrets set AMAZON_REGION="eu-west-1"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

### 3. Deploy Edge Functions

```bash
supabase functions deploy amazon-auth
supabase functions deploy amazon-sync
supabase functions deploy pack-order
supabase functions deploy get-shipping-label
supabase functions deploy scheduled-sync
```

### 4. Configure Frontend Environment

Create `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 5. Run Next.js Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## 📦 Key Workflows

### 1. Packing Workflow (`/scan`)
- SCAN AWB barcode with camera or enter manually.
- `lookup_order_by_awb` RPC queries PostgreSQL.
- Display exact product, quantity ordered, SKU, ASIN, warehouse bin location, and shipping slip.
- Click **CONFIRM PACKED** -> Edge Function locks order (`SELECT FOR UPDATE`), verifies state, writes immutable `packing_event`, updates order status, and broadcasts Realtime update.
- Sound & Vibration haptic feedback play automatically.
- Next prompt appears instantly.

### 2. Putaway Mode (`/putaway`)
- Scan product or SKU barcode.
- System displays current warehouse location & quantity.
- Select target shelf/bin (e.g. `A-01-03`) and quantity.
- `upsert_sku_location` updates `sku_location_mappings` and records immutable `putaway_event`.
- Realtime broadcast updates all connected devices.

### 3. Amazon Sync & Admin Controls (`/admin`)
- Admin clicks **SYNC NOW**.
- Edge Function exchanges LWA refresh token for access token, fetches paginated orders, order items, and Easy Ship packages.
- Upserts into PostgreSQL transactionally.
- Realtime broadcast updates the packing queue across all connected devices immediately.
