import {
  corsHeaders,
  json,
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

    const supabase = serviceClient();

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.role !== 'admin') {
      return json({ error: 'Only an administrator can issue refunds' }, 403);
    }

    const { order_id: orderId, amount, reason } = await req.json();
    if (!orderId) return json({ error: 'order_id is required' }, 400);

    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle();

    if (paymentError) throw paymentError;
    if (!payment?.provider_intent_id) return json({ error: 'No payment to refund' }, 404);
    if (payment.status !== 'succeeded') {
      return json({ error: `Payment is ${payment.status}` }, 409);
    }

    const remaining = Number(payment.amount) - Number(payment.amount_refunded);
    const refundAmount = amount != null ? Number(amount) : remaining;

    if (refundAmount <= 0 || refundAmount > remaining) {
      return json({ error: 'Refund amount exceeds the remaining balance' }, 400);
    }

    const stripe = stripeClient();
    const refund = await stripe.refunds.create(
      {
        payment_intent: payment.provider_intent_id,
        amount: toMinorUnits(refundAmount),
        metadata: { order_id: orderId, requested_by: user.id },
      },
      { idempotencyKey: `refund_${orderId}_${toMinorUnits(refundAmount)}` }
    );

    return json({ refund_id: refund.id, status: refund.status, amount: refundAmount, reason });
  } catch (error) {
    console.error('refund-order failed', error);
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500);
  }
});
