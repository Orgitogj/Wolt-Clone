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
| `0016_admin.sql` | `require_admin()`, the `admin_actions` audit log, the admin write RPCs (roles, courier review, restaurant membership, platform settings, manual dispatch) and the `admin_overview` / `admin_daily_revenue` / `admin_orders` / `admin_couriers` / `admin_users` views |
| `0017_cash_payments.sql` | Widens the `orders.payment_method` check so the cash orders `create_order` already produces are accepted |
| `0018_scheduled_jobs.sql` | Registers the pg_cron jobs for dispatch, unpaid-order expiry and location pruning; a no-op where pg_cron is unavailable |
| `0019_courier_document_upload.sql` | `submit_courier_document()` replaces the direct insert so a courier can file and replace a document without setting its review status |
| `0020_push_delivery.sql` | `claim_notifications_for_push()`, `release_notifications_for_push()` and `discard_push_token()`, the service-role side of the `send-push` worker |

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
`admin_checks.sql` covers the administrator guard on every admin RPC and view, self-demotion and
last-admin protection, courier approval, restaurant membership granting and revocation, the
platform-settings allow list, manual dispatch and the audit log.

Run them against a **non-production** database:

```bash
for t in supabase/tests/*_checks.sql; do psql "$DATABASE_URL" -f "$t"; done
```

Every check raises an exception on failure, so a clean run means all assertions passed. Every file
rolls back at the end and leaves no data behind.

`npm run verify:db` does the same thing against a throwaway Docker container, and CI runs that exact
command, so a migration that fails to apply or an assertion that fails breaks the build.

## Scheduled jobs

`0018_scheduled_jobs.sql` registers three pg_cron jobs, replacing them by name so the migration can
be re-run:

| Job | Schedule | Command |
| --- | --- | --- |
| `wolt-dispatch` | every 10 seconds | `advance_dispatch()` |
| `wolt-expire-unpaid-orders` | every minute | `expire_unpaid_orders()` |
| `wolt-prune-courier-locations` | 03:30 daily | `prune_courier_locations(30)` |

The migration is a no-op where pg_cron is not an available extension, so it applies against a plain
Postgres used for the checks. Confirm the jobs landed after applying it:

```sql
select jobname, schedule, active from cron.job where jobname like 'wolt-%';
select jobname, status, return_message, start_time
  from cron.job_run_details order by start_time desc limit 20;
```

Jobs run as the role that scheduled them, with no JWT, so `auth.uid()` is null inside them and the
order state machine sees them as the `system` actor.

## Courier documents

Documents live in the private `courier-documents` bucket under `<courier id>/<kind>.<ext>`, one
object per kind, so replacing one overwrites it rather than orphaning the old file. Storage policies
keep a courier inside their own folder and let admins read every folder.

The row itself is written by `submit_courier_document(kind, storage_path)`. Couriers have **no**
direct insert on `courier_documents`: the old insert policy only checked `courier_id`, so a courier
could have filed a document already marked `approved`. The function forces `pending`, clears any
previous review, refuses a path outside the caller's own folder, and returns a rejected courier to
`pending` when they resubmit, so a re-application reappears in the admin queue.

Which documents are required depends on the vehicle, and that list lives in the app
(`constants/deliveryStatus.ts`), not the database: approval is the administrator's judgement.

## The first administrator

`admin_set_user_role` needs an administrator to call it, so the first one has to be promoted
directly against the database:

```sql
update public.profiles set role = 'admin'
 where id = (select id from auth.users where email = 'you@example.com');
```

From then on the admin console manages roles, and the last remaining administrator cannot be
demoted.

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
courier. `0018` schedules it every ten seconds with pg_cron, so dispatch runs whether or not a
courier has the app open. The courier app also calls it while polling for offers; that call is
idempotent and stays as a fallback for deployments without pg_cron.

## Realtime and notifications

`0013` publishes `orders`, `order_status_history`, `deliveries`, `delivery_offers`,
`courier_locations` and `notifications` to `supabase_realtime`. Realtime respects RLS, so a client
only receives rows its policies already allow it to read.

Notifications are generated by a trigger on `order_status_history`, so every status change produces
the right message for the right audience without any screen duplicating that logic. The wording
lives in `notification_templates` — edit a row to change the copy, add a row to cover a new status.

Rows are written with `pushed_at = null`. The `send-push` Edge Function drains them:
`claim_notifications_for_push()` stamps the rows and returns them joined to `push_tokens` in a single
`for update skip locked` statement, so overlapping runs cannot push the same row twice, and a failed
send calls `release_notifications_for_push()` to hand the claim back. Only `service_role` may execute
any of the three functions. See `supabase/functions/README.md` for scheduling it.

Location history is only written while a courier has an active delivery, and
`prune_courier_locations(days)` trims old rows. `0018` runs it nightly with a 30 day window.

## Payments

A card order is created at `pending_payment` and posts **nothing** to the ledger. It becomes `placed`
only when `confirm_payment()` runs, and that is called exclusively by the `stripe-webhook` Edge
Function after verifying Stripe's signature — so the app cannot mark its own order paid. See
`supabase/functions/README.md`.

Card payments are gated by `platform_settings.card_payments_enabled`, which defaults to **false**.
While it is false `create_order()` rejects card orders outright, so the app falls back to
pay-on-delivery rather than pretending to charge.

`expire_unpaid_orders()` releases orders abandoned at `pending_payment`. `0018` runs it every
minute. It transitions as the system actor, which is the only role allowed to move an order out of
`pending_payment`.

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
