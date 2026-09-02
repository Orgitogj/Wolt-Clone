import {
  corsHeaders,
  json,
  requireEnv,
  serviceClient,
  stripeClient,
  toMinorUnits,
  userFromRequest,
} from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await userFromRequest(req);
    if (!user) return json({ error: 'Not signed in' }, 401);

    const { order_id: orderId } = await req.json();
    if (!orderId) return json({ error: 'order_id is required' }, 400);

    const supabase = serviceClient();

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, user_id, status, total, payment_method')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) throw orderError;
    if (!order || order.user_id !== user.id) return json({ error: 'Order not found' }, 404);

    if (order.status !== 'pending_payment') {
      return json({ error: `This order is already ${order.status}` }, 409);
    }

    const { data: settings } = await supabase
      .from('platform_settings')
      .select('currency, card_payments_enabled')
      .single();

    if (!settings?.card_payments_enabled) {
      return json({ error: 'Card payments are disabled' }, 409);
    }

    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle();

    if (paymentError) throw paymentError;
    if (!payment) return json({ error: 'No payment record for this order' }, 404);

    const stripe = stripeClient();
    const currency = (settings.currency ?? 'EUR').toLowerCase();
    const amount = toMinorUnits(order.total);

    let intent;

    if (payment.provider_intent_id) {
      intent = await stripe.paymentIntents.retrieve(payment.provider_intent_id);
      if (intent.status === 'succeeded' || intent.status === 'canceled') {
        return json({ error: 'This payment is already settled' }, 409);
      }
      if (intent.amount !== amount) {
        intent = await stripe.paymentIntents.update(payment.provider_intent_id, { amount });
      }
    } else {
      intent = await stripe.paymentIntents.create(
        {
          amount,
          currency,
          automatic_payment_methods: { enabled: true },
          metadata: { order_id: order.id, user_id: user.id },
        },
        { idempotencyKey: `order_${order.id}` }
      );

      const { error: updateError } = await supabase
        .from('payments')
        .update({ provider_intent_id: intent.id, status: 'processing' })
        .eq('id', payment.id);
      if (updateError) throw updateError;
    }

    const customer = await stripe.customers.create({ metadata: { user_id: user.id } });
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: '2024-12-18.acacia' }
    );

    return json({
      client_secret: intent.client_secret,
      publishable_key: requireEnv('STRIPE_PUBLISHABLE_KEY'),
      customer_id: customer.id,
      ephemeral_key: ephemeralKey.secret,
      amount,
      currency,
    });
  } catch (error) {
    console.error('create-payment-intent failed', error);
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500);
  }
});
