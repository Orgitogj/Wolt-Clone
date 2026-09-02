# Wolt Clone

> A production-style food delivery mobile application built with Expo, React Native, and Supabase.

## Project Overview

This repository contains a mobile app inspired by the Wolt experience. It demonstrates:

- A polished food delivery app experience for browsing restaurants, menus, and placing orders

- Native mobile UI using `expo` and `react-native`
- File-based routing with `expo-router`
- Supabase authentication, storage, and database integration
- A restaurant browsing experience with categories, menus, and dish details
- Order creation, history, and favorite restaurant support
- Persistent session storage via Async Storage

The app is structured to separate UI, data access, and business logic. It uses a Supabase backend for authentication and a relational schema that supports real-world food delivery requirements.

## Key Technologies

- `expo` / `expo-router`
- `react-native`
- `supabase-js`
- `@tanstack/react-query`
- `zustand`
- `expo-linear-gradient`
- `expo-location` and `react-native-maps`
- `typescript`

## Database Schema

The schema is defined as numbered migrations in `supabase/migrations/`, applied in filename
order. See `supabase/README.md` for what each migration contains. The main entities are:

- `profiles` — user profile data and metadata
- `addresses` — delivery addresses tied to authenticated users
- `categories` — restaurant categories and visual presentation metadata
- `restaurants` — restaurant details, ratings, menus, and location data
- `restaurant_categories` — category assignments for restaurants
- `menu_categories` — menu section groups for each restaurant
- `dishes` — dish catalog, availability, dietary tags, and pricing
- `dish_addons` — optional add-ons and price adjustments for dishes
- `favorites` — saved restaurants per user
- `orders` — placed orders with delivery, payment, and pricing fields
- `order_items` — order line items, dish snapshot, and addons
- `restaurant_members` — which users may manage which restaurant
- `restaurant_hours` — structured opening hours per weekday
- `platform_settings` — fees, limits and scheduling windows (single row)
- `order_status_transitions` — the legal order state machine
- `order_status_history` — append-only audit trail of every status change
- `couriers` / `courier_documents` — courier accounts, vehicle, availability and verification
- `deliveries` / `delivery_offers` — one delivery per delivery-mode order, and the offers made for it
- `courier_earnings` — per-delivery courier payout, including the customer tip
- `courier_locations` — GPS trail, written only while a delivery is in flight
- `notifications` / `push_tokens` / `notification_templates` — event-driven in-app and push messaging
- `payments` / `payment_transactions` / `refunds` — provider-backed payment records and webhook trail
- `ledger_entries` — signed financial movements per order (charge, payouts, commission, refunds)

Additional database behavior:

- A trigger creates `profiles` for newly registered auth users
- Row-level security is enabled on every table
- Public select policies allow restaurant and menu browsing without authentication
- A public storage bucket is configured for app image hosting

### Security model

- **Orders are never written by the client.** `create_order()` re-reads every dish and add-on
  price, recomputes the fees from `platform_settings`, enforces opening hours, minimum order and
  delivery radius, and writes `orders` + `order_items` in one transaction. Clients hold no
  `insert`/`update`/`delete` grant on either table.
- **Status is never written by the client.** `transition_order_status()` validates
  `(from, to, actor_role)` against `order_status_transitions`, locks the order row, and appends to
  `order_status_history`.
- **Roles cannot be self-assigned.** `profiles.role` and `restaurant_members` have no write grant
  for `authenticated`; only an admin or the service role can change them.
- **Repeat submissions are safe.** Checkout sends an idempotency key; a retry returns the original
  order instead of creating a second one.
- **Couriers are gated and isolated.** A courier can only go online after an admin approves them,
  only sees offers addressed to them, and can only advance a delivery assigned to them. Accepting is
  a compare-and-set, so when two couriers race for the same delivery exactly one wins.
- **Courier phone numbers never reach customers.** Tracking goes through the `delivery_couriers`
  view, which exposes name, vehicle and position only while the delivery is in flight.
- **Location data is scoped and temporary.** A courier's GPS trail is recorded only while they have
  an active delivery, is readable only by that order's customer, the restaurant and the courier, and
  becomes unreadable the moment the delivery completes.
- **Realtime respects RLS.** Live subscriptions deliver only rows the subscriber's policies already
  allow, so a client cannot listen to another user's orders.
- **The app cannot mark itself paid.** A card order is created at `pending_payment` and only becomes
  `placed` when Stripe's signed webhook reaches the `stripe-webhook` Edge Function. The charge amount
  is read from the stored order, never from the request.
- **Card payments are off by default.** `platform_settings.card_payments_enabled` starts false and
  `create_order()` rejects card orders while it is, so a half-configured deployment falls back to
  pay-on-delivery instead of taking an order it cannot charge.

## Setup Instructions

### 1. Clone the repository

```bash
git clone https://github.com/Orgitogj/Wolt-Clone.git
cd Wolt-Clone
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create environment variables

Copy the environment example and configure Supabase credentials:

```bash
cp .env.example .env
```

Edit `.env` and set:

```env
EXPO_PUBLIC_SUPABASE_URL=your-supabase-url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### 4. Configure Supabase

Apply every file in `supabase/migrations/` in filename order to your Supabase project (SQL editor
or `psql`). This establishes the tables, indexes, triggers, functions, policies, and storage bucket
used by the app.

### 5. Seed sample data (optional)

```bash
npm run seed
```

To exercise the dashboards, sign up in the app first, then set any of `SEED_MERCHANT_EMAIL`,
`SEED_COURIER_EMAIL` or `SEED_ADMIN_EMAIL` in `.env` and re-run the seed. The merchant account is
linked as owner of every seeded restaurant, the courier account is registered and approved, and the
matching dashboard appears on that account's profile screen.

### Payments (optional)

Card payments stay disabled until Stripe is configured; the app runs fine on pay-on-delivery.
To turn them on see `supabase/functions/README.md` — deploy the three Edge Functions, set the Stripe
secrets, set `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` in `.env`, then:

```sql
update public.platform_settings set card_payments_enabled = true;
```

### Android map key

`react-native-maps` uses Google Maps on Android and needs an API key; iOS uses Apple Maps and needs
nothing. Set `GOOGLE_MAPS_ANDROID_API_KEY` in `.env` — `app.config.js` injects it at build time, so
it never reaches the JS bundle. Without it the Android map renders blank.

### End-to-end walkthrough

1. Customer places a **delivery** order.
2. Merchant accepts → starts preparing → marks ready. Marking ready creates the delivery and offers
   it to the nearest online courier.
3. Courier goes online (this sends location updates), accepts the offer, confirms pickup, starts
   delivering, confirms delivery.
4. Earnings appear on the courier's earnings screen; the order reads `Delivered`.

Throughout, the customer can open the order from history to watch the status timeline and the
courier moving on a map, and every participant gets in-app notifications as the order advances.

### 6. Run the app

```bash
npm start
```

Then open the app in one of the supported targets:

- Android emulator
- iOS simulator
- Expo Go

## Checks

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint
npm run verify:db   # migrations + RLS/lifecycle assertions in a throwaway Postgres (needs Docker)
```

`npm run verify:db` starts a disposable `postgres:16-alpine` container, stubs the Supabase-specific
schemas, applies every migration and runs `supabase/tests/rls_checks.sql`, which asserts that price
tampering, cross-tenant reads, illegal status transitions and role escalation are all rejected. It
never touches your real project. The same three checks run in CI.

## App Architecture

- `app/` — main Expo Router pages and navigation structure
- `components/` — reusable UI components and buttons
- `constants/orderStatus.ts` — status labels, tones and the merchant action map
- `constants/deliveryStatus.ts` — delivery labels, courier steps and GPS update thresholds
- `hooks/useRealtime.ts` — one Supabase Realtime subscription helper used by every live screen
- `app.config.js` — build-time config overlay for secrets that must not reach the JS bundle
- `supabase/functions/` — Deno Edge Functions for payment intents, the Stripe webhook and refunds
- `hooks/` — custom hooks for profile, restaurants, menu, favorites, orders and the merchant view
- `lib/supabase.ts` — Supabase client configuration
- `services/` — backend service layer for data queries and mutations
- `supabase/migrations/` — numbered schema migrations, functions and RLS policies
- `supabase/tests/` — database verification scripts
- `scripts/seed.mjs` — optional data seeding script
- `scripts/verify-db.mjs` — local database verification runner

## GitHub

Repository: https://github.com/Orgitogj/Wolt-Clone

## How to Review

A reviewer can verify:

- Authentication flow via Supabase
- Restaurant listing and category filtering
- Menu browsing and dish selection
- Order placement and history retrieval
- Profile editing and address management
- Backend policy enforcement and secure user data access

