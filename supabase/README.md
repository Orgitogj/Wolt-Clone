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
| `0021_search.sql` | `search_restaurants()`, `search_dishes()` and `distinct_cuisines()` move catalogue search, filtering, sorting and paging into the database, with the full-text and sort indexes they rely on |
| `0022_reviews.sql` | `reviews` and `review_responses`, the submit/edit/delete/respond/moderate RPCs, the rating aggregate trigger and the guard that stops anyone writing `restaurants.rating` directly |
| `0023_promotions.sql` | `promotions` and `promotion_redemptions`, server-side code evaluation, the redemption lifecycle trigger, the admin promotion RPCs, and `create_order` extended with `p_promo_code` |
| `0024_payment_reconciliation.sql` | `payment_reconciliations`, the claim/resolve/fail worker RPCs, and a `confirm_payment` that refunds instead of reviving an order that already closed |
| `0025_order_chat.sql` | `order_messages`, `order_message_reads`, `delivery_assignments`, the chat access/send/paging RPCs, and a dispatch-time push recheck |
| `0026_refund_recovery.sql` | Worker leases on `payment_reconciliations`, the claim/resolve/outcome/fail RPCs, `admin_retry_payment_reconciliation()`, `sanitize_error_text()` and the scheduled refund worker |
| `0027_support.sql` | `support_tickets`, `support_ticket_items`, `support_messages`, `support_refunds`, `support_message_reads`; reporting eligibility, the ticket and conversation RPCs, the admin workflow RPCs, full and partial refunds through the reconciliation worker, the cash refund confirmation, `post_ledger_delta()` and the ledger reversal rules, and the support tables added to the realtime publication |
| `0028_cart_validation.sql` | `price_cart_line()` becomes the one place a cart line is priced, `create_order` calls it instead of repeating the logic, and `validate_cart()` reports current prices, availability, missing add-ons, opening hours and the minimum order so a restored basket can be checked before it is submitted |

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
`cart_checks.sql` covers a price that moved, a dish taken off the menu, a deleted add-on, a closed
restaurant, a dish id belonging to another restaurant, invalid quantities, the minimum order, an empty
basket, and that `validate_cart` and `create_order` agree on the price of the same line.
`support_checks.sql` covers ticket ownership, the reporting window and its limits, invalid items and
quantities, duplicate submissions, conversation permissions and paging, admin-only assignment,
status and refund approval, stale-revision protection, refund amount validation, several partial
refunds and the exact remaining balance, the ledger entries each refund writes, the cash refund
confirmation and notification isolation.

Run them against a **non-production** database:

```bash
for t in supabase/tests/*_checks.sql; do psql "$DATABASE_URL" -f "$t"; done
```

Every check raises an exception on failure, so a clean run means all assertions passed. Every file
rolls back at the end and leaves no data behind.

`npm run verify:db` does the same thing against a throwaway Docker container, and CI runs that exact
command, so a migration that fails to apply or an assertion that fails breaks the build.

`npm run verify:db:concurrent` drives several real psql sessions against a throwaway container to
check what a single session cannot: two customers racing the last promotion redemption, two couriers
racing one delivery, a send racing a reassignment or a closure, two customers reporting one order,
two admins taking or resolving one ticket, two refunds racing the last of the balance, a repeated
approval, a support refund racing the automatic reconciliation, and two workers settling one refund.

`npm run verify:rpc-compat` starts PostgREST against the same container and calls the RPCs the way
the app does, so a parameter rename or a lost grant is caught before it reaches a client.

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

### Catalogue search

`search_restaurants(search, category_id, cuisines, price_tier, wolt_plus_only, sort, limit, offset)`
is the one entry point the app uses to browse and search restaurants. It runs as the caller, so the
public read policy still decides what comes back, and it returns `setof public.restaurants` so the
client keeps the row type it already had.

Text matching uses `websearch_to_tsquery` over name, description, cuisines and tags, backed by the
`restaurants_search_idx` GIN index. A null or blank query applies no text filter at all, so an empty
search box is an ordinary paged browse rather than an empty screen. `search_dishes()` is the
opposite: it returns nothing without a query, and never returns an unavailable dish.

Sorting and paging happen in the database. The client asks for one page at a time and never pulls
the catalogue down to filter or sort it locally.

### Reviews

A review belongs to one delivered order (`reviews.order_id` is unique), so eligibility, ownership and
duplicate submission are all decided by the database. `submit_review()`, `update_review()`,
`delete_review()`, `respond_to_review()` and `moderate_review()` are the only write paths; clients
hold no insert, update or delete grant on `reviews`.

`restaurants.rating` and `restaurants.review_count` are recalculated from visible reviews by a
trigger. A second trigger refuses any other write to those two columns, so a restaurant member who
can otherwise edit their own row still cannot inflate its rating. Hidden and removed reviews drop out
of the public list and out of the aggregate; the author keeps seeing their own.

### Promotions

`create_order()` takes a promo code, never a discount. It re-reads the promotion under a row lock,
re-checks validity window, restaurant restriction, minimum basket, global cap and per-customer cap,
computes the discount itself and writes `promotion_redemptions` in the same transaction as the order.
A repeated submission with the same idempotency key returns the original order before any reservation
runs, so a retry cannot redeem a code twice.

The discount applies to the **eligible subtotal** (dishes and add-ons only) and is clamped to that
subtotal, so fees and the tip are never discounted away and a total can never go negative. Money
stays `numeric(x,2)` and every discount is rounded to cents.

Who pays: `charge` is the discounted `orders.total`, while `restaurant_payout` and
`platform_commission` are still computed from the full `orders.subtotal`. The restaurant settles on
what it sold and the **platform funds the discount**, which falls out of `post_order_ledger()`
unchanged and is counted exactly once in `order_financials.platform_net`.

Redemptions follow the order: `cancelled`, `payment_failed` and `restaurant_rejected` release the
reservation back to the cap, `delivered` consumes it. Each order keeps a `promotion_snapshot`, so
editing or deactivating a promotion never rewrites a historical order.

### Late payments

`confirm_payment()` never revives an order that already closed. When a provider success arrives for
an order that is `payment_failed`, `cancelled`, `restaurant_rejected` or `refunded`, it still records
the money as captured and posts the `charge` ledger entry, but it posts **no** restaurant payout or
commission and opens a `payment_reconciliations` row asking for a refund.

That queue is durable and retryable: `claim_payment_reconciliations()` hands work out with
exponential backoff and `for update skip locked`, `resolve_payment_reconciliation()` records the
refund through the existing idempotent `record_refund()`, and `fail_payment_reconciliation()` keeps
the row visible with its error until it succeeds or is abandoned after ten attempts. A partial unique
index allows only one open reconciliation per payment, so duplicate webhooks cannot queue a second
refund. The `reconcile-payments` function performs the Stripe refund with the stored
`provider_idempotency_key`, so a crash between provider success and database persistence retries
without refunding twice.

### Order chat

A conversation belongs to an order. Only the order's customer and the **currently** assigned courier
may read it, and sending additionally requires a courier to be assigned and the order not to be
closed. After delivery or cancellation both the customer and the final assigned courier keep read
access and lose the right to send.

On reassignment the previous courier loses read access, send rights and push eligibility
immediately, because every check reads `deliveries.courier_id` rather than a stored participant list.
`delivery_assignments` keeps the history of who held the order and when. A newly assigned courier
**does** read the earlier messages for that order: the conversation is delivery context for the order
they now carry.

`send_order_message()` locks the delivery row before it decides the sender's role, so a reassignment
racing a send cannot authorise the wrong courier. Messages carry a client-generated
`client_message_id` that is unique per order, so a retry after a lost response returns the original
message instead of storing a duplicate. Sender identity, role and recipient are always taken from the
session, never from the request.

### Order support

A support ticket belongs to an order and to the customer who placed it. `submit_support_ticket()`
locks the order row, re-checks eligibility and only then writes, so the same order cannot acquire two
open tickets. Eligibility is decided on the server by `support_report_eligibility()`:

| Reason | Meaning |
| --- | --- |
| `eligible` | the order is finished, inside the window and has no open ticket |
| `unknown_order` | no such order |
| `not_your_order` | the order belongs to another account |
| `not_delivered_yet` | the order has not reached a reportable state |
| `too_old` | the order is older than `support_report_window_days()` (7) |
| `already_open` | a ticket for this order is still open or in review |
| `too_many_tickets` | the order already reached `support_max_tickets_per_order()` (5) |

Reported items are validated against the order: an item id must belong to that order and the
quantity must be between 1 and the quantity actually ordered. A refused report leaves nothing behind.

Every report carries a client-generated `client_ticket_id`, unique per customer, and every message a
`client_message_id`, unique per ticket. A retry after a lost response returns the original row rather
than creating a second one. Sender identity and role always come from the session, never the request.

Only the ticket's customer and administrators can read a ticket, its items, its conversation and its
refunds. The restaurant and the courier are excluded: a support conversation can discuss refunds and
liability, so it is not delivery context. `support_messages_page()` pages backwards on
`(created_at, id)`, so messages sharing a timestamp are each returned exactly once.

Unread counts come from `support_message_reads`, one row per ticket and reader.
`mark_support_messages_read()` moves that reader's marker and marks the ticket's own support
notifications read, so the badge clears when the ticket is opened and returns on the next reply from
the other side. A reader's own messages are never unread to them, and a marker is private to its
owner: nobody can read or forge another reader's position.

A customer message on a resolved ticket reopens it, up to `support_max_reopens()` (3) times. Admin
workflow changes go through `admin_assign_support_ticket()` and `admin_set_support_status()`, which
both take the `revision` the screen was showing. They lock the ticket row and refuse a stale
revision, so two admins acting at once cannot silently overwrite each other, and every change is
written to `admin_actions`.

### Support refunds

`admin_approve_support_refund()` is the only way to approve a refund. It requires an administrator, a
reason and an amount greater than zero, and it takes an optional `client_request_id` so a double tap
approves once. It locks the ticket, then the order, then the payment, and compares the amount against
`order_refund_summary()`, which subtracts from the charge:

- refunds already confirmed,
- support refunds still `reserved`,
- automatic `refund_unfulfilled_order` jobs that have not resolved.

An approval reserves the amount. Several partial refunds can therefore be open on one order at once
and their total can never exceed what was charged. Each refund gets its own
`provider_idempotency_key`, so each reaches the provider as a distinct refund.

A card refund is queued as a `support_refund` reconciliation and settled by the worker:
`resolve_payment_reconciliation()` confirms the support refund, and
`fail_payment_reconciliation()` fails it once the job is abandoned, which releases the reservation
back into the balance. `admin_retry_payment_reconciliation()` can revive an abandoned job, but it
re-reserves the amount first and refuses when the order can no longer cover it.

A cash order has no `payments` row, so there is nothing to refund through the provider. A cash refund
waits in `reserved` until `admin_confirm_cash_refund()` records that the money was handed back,
with a settlement note, in the audit log. Confirming twice does not refund twice.

A ticket cannot be resolved while any of its refunds is still `reserved`.

Liability is explicit. By default the platform bears the refund and only the customer `refund` entry
is written. With `liability => 'restaurant'` a **positive** `restaurant_payout` entry claws the
amount back, which works because `order_financials` reports `-sum(restaurant_payout)`.

`ledger_entries` holds one row per `(order, entry_type, party)`, so it is a running balance rather
than an append-only log. Refunds post through `post_ledger_delta()`, which adds to the existing row,
and each refund writes its ledger delta exactly once because the state guard runs under the row
lock. Failure text from the provider passes through `sanitize_error_text()` before it is stored or
shown.
