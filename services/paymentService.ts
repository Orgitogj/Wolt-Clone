import { supabase } from '@/lib/supabase';
import type { OrderFinancials, Payment, PaymentIntentResponse, Refund } from '@/types/database';

export const paymentService = {
  createIntent: async (orderId: string): Promise<PaymentIntentResponse> => {
    const { data, error } = await supabase.functions.invoke<PaymentIntentResponse>(
      'create-payment-intent',
      { body: { order_id: orderId } }
    );
    if (error) throw new Error(await readFunctionError(error));
    if (!data?.client_secret) throw new Error('The payment could not be started.');
    return data;
  },

  getForOrder: async (orderId: string): Promise<Payment | undefined> => {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle();
    if (error) throw error;
    return (data ?? undefined) as Payment | undefined;
  },

  listRefunds: async (orderId: string): Promise<Refund[]> => {
    const { data, error } = await supabase
      .from('refunds')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Refund[];
  },

  getFinancials: async (orderId: string): Promise<OrderFinancials | undefined> => {
    const { data, error } = await supabase
      .from('order_financials')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle();
    if (error) throw error;
    return (data ?? undefined) as OrderFinancials | undefined;
  },

  refundOrder: async (orderId: string, amount?: number, reason?: string): Promise<void> => {
    const { error } = await supabase.functions.invoke('refund-order', {
      body: { order_id: orderId, amount, reason },
    });
    if (error) throw new Error(await readFunctionError(error));
  },
};

const readFunctionError = async (error: unknown): Promise<string> => {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    const body = await context.json().catch(() => null);
    if (body?.error) return String(body.error);
  }
  return error instanceof Error ? error.message : 'The payment service is unavailable.';
};
