# Database

Migrations are numbered and **applied in filename order**. They are idempotent, so
re-running the whole folder against an existing project is safe.

| Migration | Contents |
| --- | --- |
| `0001_initial_schema.sql` | Baseline: profiles, addresses, restaurants, menus, favourites, orders, storage bucket, `handle_new_user` trigger |
| `0002_roles.sql` | `user_role` enum, `profiles.role`, `restaurant_members`, `is_admin()`, `manages_restaurant()`, `order_actor_role()`, role-escalation column grants |
| `0003_platform_settings.sql` | `platform_settings` singleton, `restaurant_hours` (+ backfill from the old jsonb), `is_restaurant_open()` |
| `0004_order_lifecycle.sql` | `order_status` enum, `order_status_transitions`, `order_status_history`, `transition_order_status()`, write-grant lockdown |
| `0005_order_creation.sql` | `create_order()` (server-side pricing, idempotency, rule enforcement) and `quote_order_fees()` |
| `0006_rls_policies.sql` | Full RLS rewrite against the role model |
| `0007_couriers.sql` | `couriers`, `courier_documents`, verification states, availability, location updates, courier fee settings |
| `0008_deliveries.sql` | `deliveries`, `delivery_offers`, `courier_earnings`; teaches `order_actor_role()` about couriers |
| `0009_dispatch.sql` | Delivery creation trigger, candidate ranking, timed offers, race-safe acceptance, courier flow, earnings |
| `0010_courier_rls.sql` | Courier/delivery RLS, the `delivery_couriers` tracking view, private document bucket |
| `0011_courier_locations.sql` | `courier_locations` history, `record_courier_location()`, retention pruning, location RLS |
| `0012_notifications.sql` | `notifications`, `push_tokens`, `notification_templates`, the status-history notification trigger |
| `0013_realtime.sql` | Adds the live tables to the `supabase_realtime` publication |
| `0014_payments.sql` | `payments`, `payment_transactions`, `refunds`, `ledger_entries`, the `order_financials` view, commission settings |
| `0015_payment_flow.sql` | Card orders start at `pending_payment`; `confirm_payment` / `fail_payment` / `record_refund` / `expire_unpaid_orders`; ledger posting |

## Applying

Paste each file into the Supabase SQL editor in order, or with the Supabase CLI linked to the project:

```bash
for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

## Verifying

`supabase/tests/*_checks.sql` assert the security properties this schema is supposed to have.
`rls_checks.sql` covers price tampering, cross-tenant reads, illegal status transitions, role
escalation and idempotency. `courier_checks.sql` covers courier approval gating, dispatch ranking,
two couriers racing for the same delivery, cross-courier access and earnings.
`realtime_checks.sql` covers notification fan-out per audience, notification isolation, courier
location privacy while and after a delivery, push-token isolation and the realtime publication.
`payment_checks.sql` covers the unpaid-order gate, webhook-driven placement, webhook replay
idempotency, ledger arithmetic, refund limits, cross-customer payment isolation and unpaid expiry.

Run them against a **non-production** database:

```bash
for t in supabase/tests/*_checks.sql; do psql "$DATABASE_URL" -f "$t"; done
```

Every check raises an exception on failure, so a clean run means all assertions passed. Both files
roll back at the end and leave no data behind.

## Rules this schema enforces

- Orders can only be created through `create_order()`. Clients have no `insert`/`update`/`delete`
  grant on `orders` or `order_items`, so prices, fees and totals cannot come from the app.
- `orders.status` can only be changed through `transition_order_status()`, which validates
  `(from, to, actor_role)` against `order_status_transitions` and appends to `order_status_history`.
- `profiles.role` has no `update` grant for `authenticated`; only an admin or the service role can
  change a role. The same applies to `restaurant_members`.
- Fees, limits and scheduling windows live in `platform_settings`, not in code.
- A courier can only go online once an admin approves them, and only ever sees offers addressed to
  them. Accepting a delivery is a compare-and-set on `deliveries`, so exactly one courier wins a
  race.
- Customers and restaurants never read the `couriers` table. They see the assigned courier through
  the `delivery_couriers` view, which exposes name, vehicle and position but not phone number, and
  only while the delivery is in flight.

## Dispatch

`advance_dispatch()` expires timed-out offers and offers pending deliveries to the next-best
courier. The courier app calls it while polling for offers, which is enough for development. In
production schedule it instead:

```sql
select cron.schedule('dispatch', '10 seconds', 'select public.advance_dispatch()');
```

## Realtime and notifications

`0013` publishes `orders`, `order_status_history`, `deliveries`, `delivery_offers`,
`courier_locations` and `notifications` to `supabase_realtime`. Realtime respects RLS, so a client
only receives rows its policies already allow it to read.

Notifications are generated by a trigger on `order_status_history`, so every status change produces
the right message for the right audience without any screen duplicating that logic. The wording
lives in `notification_templates` — edit a row to change the copy, add a row to cover a new status.

Rows are written with `pushed_at = null`. Delivering them as actual push notifications needs a
worker (a Supabase Edge Function on a schedule) that reads unsent rows, looks up `push_tokens`,
posts to the Expo push API and stamps `pushed_at`. That worker is **not** part of this repo yet;
in-app notifications and the realtime badge work without it.

Location history is only written while a courier has an active delivery, and
`prune_courier_locations(days)` trims old rows.

## Payments

A card order is created at `pending_payment` and posts **nothing** to the ledger. It becomes `placed`
only when `confirm_payment()` runs, and that is called exclusively by the `stripe-webhook` Edge
Function after verifying Stripe's signature — so the app cannot mark its own order paid. See
`supabase/functions/README.md`.

Card payments are gated by `platform_settings.card_payments_enabled`, which defaults to **false**.
While it is false `create_order()` rejects card orders outright, so the app falls back to
pay-on-delivery rather than pretending to charge.

`expire_unpaid_orders()` releases orders abandoned at `pending_payment`. Schedule it alongside
dispatch:

```sql
select cron.schedule('expire-unpaid', '1 minute', 'select public.expire_unpaid_orders()');
```

### Ledger

Every settled order posts signed entries to `ledger_entries`, positive when the platform receives and
negative when it owes:

| Entry | Party | Amount |
| --- | --- | --- |
| `charge` | customer | `+total` |
| `restaurant_payout` | restaurant | `-(subtotal - commission)` |
| `platform_commission` | platform | `+subtotal * commission_rate` (informational) |
| `courier_payout` | courier | `-(base + per-km + tip)`, posted on delivery |
| `refund` | customer | `-refunded` |

`order_financials` aggregates this per order and is filtered to the order's customer, its restaurant
and admins. `platform_net` excludes the informational commission row so it is not counted twice.
