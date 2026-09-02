import Stripe from 'npm:stripe@17.5.0';
import { requireEnv, serviceClient, stripeClient } from '../_shared/stripe.ts';

const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing stripe-signature', { status: 400 });
  }

  const body = await req.text();
  const stripe = stripeClient();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      requireEnv('STRIPE_WEBHOOK_SECRET'),
      undefined,
      cryptoProvider
    );
  } catch (error) {
    console.error('Signature verification failed', error);
    return new Response('Invalid signature', { status: 400 });
  }

  const supabase = serviceClient();

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const intent = event.data.object as Stripe.PaymentIntent;
        const { error } = await supabase.rpc('confirm_payment', {
          p_provider_intent_id: intent.id,
          p_provider_charge_id: (intent.latest_charge as string) ?? null,
          p_provider_event_id: event.id,
          p_payload: { status: intent.status, amount: intent.amount },
        });
        if (error) throw error;
        break;
      }

      case 'payment_intent.payment_failed': {
        const intent = event.data.object as Stripe.PaymentIntent;
        const { error } = await supabase.rpc('fail_payment', {
          p_provider_intent_id: intent.id,
          p_reason: intent.last_payment_error?.message ?? 'Payment failed',
          p_provider_event_id: event.id,
          p_payload: { status: intent.status },
        });
        if (error) throw error;
        break;
      }

      case 'payment_intent.canceled': {
        const intent = event.data.object as Stripe.PaymentIntent;
        const { error } = await supabase.rpc('fail_payment', {
          p_provider_intent_id: intent.id,
          p_reason: 'Payment cancelled',
          p_provider_event_id: event.id,
          p_payload: { status: intent.status },
        });
        if (error) throw error;
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        const intentId =
          typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : charge.payment_intent?.id;

        if (!intentId) break;

        const refund = charge.refunds?.data?.[0];
        if (!refund) break;

        const { error } = await supabase.rpc('record_refund', {
          p_provider_intent_id: intentId,
          p_provider_refund_id: refund.id,
          p_amount: refund.amount / 100,
          p_reason: refund.reason ?? 'Refunded',
          p_provider_event_id: event.id,
          p_payload: { charge_id: charge.id },
        });
        if (error) throw error;
        break;
      }

      default:
        break;
    }
  } catch (error) {
    console.error(`Failed handling ${event.type}`, error);
    return new Response('Handler failed', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
