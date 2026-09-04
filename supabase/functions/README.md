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
