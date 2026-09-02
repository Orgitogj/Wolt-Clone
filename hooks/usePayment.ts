import { paymentService } from '@/services/paymentService';
import { useStripe } from '@stripe/stripe-react-native';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

export type PaymentOutcome =
  | { status: 'succeeded' }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

export const usePayForOrder = () => {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [isPaying, setIsPaying] = useState(false);

  const pay = useCallback(
    async (orderId: string, merchantName: string): Promise<PaymentOutcome> => {
      setIsPaying(true);
      try {
        const intent = await paymentService.createIntent(orderId);

        const { error: initError } = await initPaymentSheet({
          merchantDisplayName: merchantName,
          paymentIntentClientSecret: intent.client_secret,
          customerId: intent.customer_id,
          customerEphemeralKeySecret: intent.ephemeral_key,
          allowsDelayedPaymentMethods: false,
          returnURL: 'wolt://order',
        });

        if (initError) {
          return { status: 'failed', message: initError.message };
        }

        const { error: sheetError } = await presentPaymentSheet();

        if (sheetError) {
          if (sheetError.code === 'Canceled') return { status: 'cancelled' };
          return { status: 'failed', message: sheetError.message };
        }

        return { status: 'succeeded' };
      } catch (error) {
        return {
          status: 'failed',
          message: error instanceof Error ? error.message : 'The payment could not be completed.',
        };
      } finally {
        setIsPaying(false);
      }
    },
    [initPaymentSheet, presentPaymentSheet]
  );

  return { pay, isPaying };
};

export const useOrderPayment = (orderId: string | undefined) =>
  useQuery({
    queryKey: ['payment', orderId],
    queryFn: () => paymentService.getForOrder(orderId!),
    enabled: !!orderId,
  });

export const useOrderFinancials = (orderId: string | undefined) =>
  useQuery({
    queryKey: ['order-financials', orderId],
    queryFn: () => paymentService.getFinancials(orderId!),
    enabled: !!orderId,
  });
