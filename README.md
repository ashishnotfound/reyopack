# Reyo Pack

Reyo Pack is a standalone warehouse operating system for Reyo Store. Its hot path is designed for an Android Chrome/PWA device:

```text
Start session → scan AWB → see exact item and quantity → PACKED → next scan
```

It owns its own Next.js application, Supabase schema, authentication, realtime subscriptions, Amazon SP-API synchronization, GitHub repository, and Vercel deployment.

## Architecture

- Next.js 16 App Router, React 19, TypeScript, Tailwind-free operational CSS, and installable PWA metadata.
- Browser camera scanning uses ZXing with Code 128, EAN/UPC, QR, Data Matrix, PDF417, and ITF support. Manual AWB entry remains available.
- Server Route Handlers validate request bodies with Zod and enforce Supabase-authenticated roles before calling RPCs or Edge Functions.
- PostgreSQL is the source of truth. Migration `005_production_hardening.sql` adds server-side actor checks, row locking, persistent packing idempotency, immutable cancellation events, and security-definer search paths.
- Supabase Realtime propagates order, event, shipment, location, session, and sync-run changes. API mutations never rely on browser-only state.
- Amazon credentials are server-side Supabase secrets only. The sync function performs LWA refresh-token exchange, paginated Orders/Order Items reads, Easy Ship package reads where available, safe upserts, retries, and sync-run/error recording.

## Local setup

Requirements: Node.js 20+, a Supabase project, and (for Amazon synchronization) a Selling Partner API application with the required Amazon.in authorization.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Run the quality gates:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Environment variables

The browser only receives the Supabase URL and publishable/anon key. Never put service-role, LWA, refresh-token, or cron secrets in a `NEXT_PUBLIC_*` variable.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
# Compatibility name accepted when publishable key is unavailable:
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Server/Edge Function secrets; keep out of browser bundles.
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_BOOTSTRAP_TOKEN=
AMAZON_CLIENT_ID=
AMAZON_CLIENT_SECRET=
AMAZON_SP_API_REFRESH_TOKEN=
AMAZON_SELLER_ID=
AMAZON_MARKETPLACE_ID=A21TJRUUN4KGV
AMAZON_SP_API_REGION=eu-west-1
CRON_SECRET=
APP_ORIGIN=https://your-reyo-pack-domain.vercel.app
```

For deployed Supabase Edge Functions, set the Amazon and `CRON_SECRET` values with Supabase secrets. `SUPABASE_SERVICE_ROLE_KEY` is used by Edge Functions and must never be exposed to React. The app intentionally does not store LWA client secrets or refresh tokens in `system_settings`.

## Database setup

Apply all migrations in order:

```bash
supabase db push
```

Or apply the files in `supabase/migrations/` with the Supabase SQL editor. Do not use the legacy `REYO_PACK_SUPABASE_AIO.sql` as a production substitute for versioned migrations.

After the first user signs up, create the first administrator through the protected setup flow:

1. Set a strong, temporary `ADMIN_BOOTSTRAP_TOKEN` in the server/Vercel environment.
2. Sign in with the owner account and open `/bootstrap-admin`.
3. Enter the token. The server checks that no administrator exists, promotes the signed-in account in a locked database transaction, and records an audit event.
4. Remove or rotate the bootstrap token after setup. Subsequent attempts are rejected once any administrator exists.

New signups are always created as `PACKER`; signup metadata cannot self-promote a user.

Enable Realtime for the tables listed in `002_rls.sql` if the project was created without the migration publication. RLS policies are part of the migrations and privileged writes use security-definer RPCs or service-role Edge Functions.

## Amazon SP-API synchronization

`supabase/functions/amazon-sync` supports:

- incremental lookback synchronization and paginated `Orders` reads;
- order-item reads and SKU matching;
- Easy Ship package/tracking data when Amazon returns it;
- cancellation preservation as an append-only event;
- exponential backoff for throttling and transient 5xx responses;
- safe order/item/shipment updates without trusting client input;
- `sync_runs` and `sync_errors` records for operator-visible health.

The admin panel calls `/api/admin/sync`. The scheduled route `/api/cron/sync` is protected by `CRON_SECRET`, and `vercel.json` schedules it hourly. If the Vercel plan does not permit the desired cadence, use a Supabase/Vercel-compatible scheduler to invoke the same protected route. Shipping documents are shown only when Amazon returns a real label/document reference; the app does not fabricate one.

Deploy the Edge Functions and configure their secrets using the Supabase dashboard or CLI. Amazon API access is not testable until valid production credentials, seller authorization, and the correct marketplace permissions are supplied.

## Operational workflows

- **Pack:** `/scan` requires an explicit active packing session, uses an indexed AWB RPC, blocks offline confirmations, and sends `PACKED` through a transaction that locks the order row and deduplicates retries.
- **Duplicate scans:** a retry with the same idempotency key replays the confirmed event; a simultaneous second device gets `ALREADY_PACKED` or `LOCK_CONFLICT`.
- **Cancellation:** Amazon cancellation changes current state but never deletes earlier packing events. Cancellation scans render `DO NOT PACK`.
- **Putaway:** `/putaway` resolves SKU/barcode data and records SKU → location assignments through an authorized RPC plus append-only putaway history.
- **Offline:** the PWA caches only a small shell. Operational reads and mutations are network-authoritative; no offline action is presented as server-confirmed.

## Vercel deployment

Import the `reyo-pack` GitHub repository as a Next.js project. Set the public Supabase variables in Preview/Production and configure `CRON_SECRET`. Configure the Supabase Edge Function secrets separately. Use the Vercel production URL for Android installation; the PWA avoids caching API responses so an operator cannot unknowingly run stale order state.

Health check:

```text
GET /api/health
```

It returns configuration booleans only and never exposes secret values.

## Security notes

- Route Handlers call `auth.getUser()` server-side and enforce active profile roles.
- RLS remains enabled for application tables; browser code does not write orders, events, audit logs, or Amazon settings directly.
- The packing state transition is transactional and idempotent in PostgreSQL, not in React.
- Security headers include `nosniff`, strict referrer policy, frame denial, and camera permission scoping.
- Logs and errors avoid access tokens and secrets. Amazon token exchange responses are never returned to clients.

## Known external configuration boundary

The source code, migrations, tests, build, and deployment wiring can be verified without third-party credentials. Production login, realtime database operation, Amazon sync, and live packing require a Supabase production project plus its public keys. Amazon functionality additionally requires the server-side LWA/SP-API secrets and seller authorization described above.
