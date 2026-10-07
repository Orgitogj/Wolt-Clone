# Edge Functions

Four Deno functions handle everything that needs a secret key or a trusted origin. They are the
only server-side code in the project; the app itself never talks to Stripe's API directly.

| Function | Caller | Purpose |
| --- | --- | --- |
| `create-payment-intent` | The app, with the user's JWT | Verifies the caller owns the order, reads the amount **from the stored order**, creates a Stripe PaymentIntent and returns a client secret |
| `stripe-webhook` | Stripe | Verifies the signature, then calls `confirm_payment` / `fail_payment` / `record_refund` |
| `refund-order` | The app, admin only | Creates a Stripe refund; the resulting webhook is what actually records it |
| `send-push` | A scheduler, with the service-role key | Claims unsent `notifications`, posts them to the Expo push API and discards tokens the device has unregistered |

## Why the amount is never sent from the app

`create-payment-intent` accepts only an `order_id`. It loads the order with the service-role key and
charges `orders.total`, which was itself computed by `create_order()` from the database's own prices.
A tampered client can change nothing about what it is charged.

## Why the webhook is the source of truth

The app never tells the backend that a payment succeeded. `payment_intent.succeeded` arrives from
Stripe with a signature, and only then does the order move `pending_payment → placed` — recorded in
`order_status_history` with `actor_role = 'system'`. If the app is killed mid-payment the order still
completes correctly.

Webhook delivery is at-least-once, so every handler is idempotent: `payment_transactions` has a
unique `provider_event_id`, and `confirm_payment` returns early if the payment is already succeeded.

## Deploying

```bash
supabase functions deploy create-payment-intent
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy refund-order
supabase functions deploy send-push
```

`stripe-webhook` must use `--no-verify-jwt` because Stripe does not send a Supabase JWT. It is not
unauthenticated: the Stripe signature is verified inside the handler, and a request without a valid
one is rejected with 400.

## Secrets

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_or_test_...
supabase secrets set STRIPE_PUBLISHABLE_KEY=pk_live_or_test_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
The secret key exists only here — never in `.env`, never in an `EXPO_PUBLIC_` variable, never in the
app bundle.

## Stripe dashboard setup

1. Add an endpoint pointing at `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`.
2. Subscribe to `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `payment_intent.canceled` and `charge.refunded`.
3. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

## Turning card payments on

Card payments stay off until the flag is set, and `create_order()` rejects card orders while it is
false — so a half-configured deployment cannot take an order it can't charge:

```sql
update public.platform_settings set card_payments_enabled = true;
```

Also set `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` in `.env` and rebuild the app.

## Sending pushes

`send-push` is the worker behind the notification rows. It refuses any caller that does not present
the service-role key, so it is never invoked from the app.

Each run calls `claim_notifications_for_push()`, which stamps `pushed_at` and returns the unsent rows
already joined to `push_tokens` in one statement, under `for update skip locked`. Two overlapping
runs therefore cannot send the same notification twice. A recipient with no registered device is
stamped as well, so it is not retried forever, and a notification older than a day is left alone
rather than delivered stale.

If the Expo request fails the handler calls `release_notifications_for_push()` to undo the claim, so
a network blip delays a push instead of losing it. A ticket that comes back
`DeviceNotRegistered` removes that token with `discard_push_token()`.

Schedule it with pg_cron and pg_net. The project reference and the key are deployment specific, so
this is not in a migration:

```sql
select vault.create_secret('<service-role-key>', 'service_role_key');

select cron.schedule('wolt-send-push', '30 seconds', $job$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'
      )
    ),
    body := '{"limit": 200}'::jsonb
  );
$job$);
```

Anything that can hold the key and call a URL on a timer works just as well.

## Local testing

```bash
supabase functions serve
stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook
stripe trigger payment_intent.succeeded
```

## reconcile-payments

Returns captured money for orders that closed before the payment landed. `confirm_payment()` queues a
`payment_reconciliations` row; this worker drains it.

It is authenticated the same way as `send-push`: the request must carry
`Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`, compared in constant time, and anything else is
rejected with 401.

Before issuing any refund it lists the refunds Stripe already holds for the payment intent and
matches on `metadata.reconciliation_id`. That is what makes a crash between Stripe success and
database persistence safe, and it keeps working past Stripe's 24 hour idempotency retention window,
where replaying the stored key would otherwise create a second refund. A refund is only reported as
finished when the provider says `succeeded`; `pending` and `processing` are recorded and retried. If
the intent is already fully refunded by someone else, the job settles without refunding again.

### Scheduling

Migration `0026` registers the pg_cron job `wolt-reconcile-payments` (every five minutes), which
calls `public.invoke_reconcile_payments()`. That function reads the function base URL and the service
role key from **Supabase Vault**, so no credential appears in a committed migration, in a log line or
in the client bundle. It no-ops with a notice where `pg_cron`, `pg_net` or Vault are unavailable, so
local verification runs unaffected.

Store the secrets once per environment:

```bash
SUPABASE_DB_URL='postgres://...' WOLT_FUNCTIONS_URL='https://<project-ref>.supabase.co/functions/v1' SUPABASE_SERVICE_ROLE_KEY='<service role key>' npm run configure:refund-worker
```

The script is idempotent: it updates the Vault entries when they already exist and reports whether
the cron job is registered. Deploy the function with `supabase functions deploy reconcile-payments`.
Until both steps run the queue simply accumulates, stays visible under **Admin → Refunds**, and
nothing is reported as refunded.
