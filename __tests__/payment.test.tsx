jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

const mockInitPaymentSheet = jest.fn();
const mockPresentPaymentSheet = jest.fn();

jest.mock('@stripe/stripe-react-native', () => ({
  useStripe: () => ({
    initPaymentSheet: mockInitPaymentSheet,
    presentPaymentSheet: mockPresentPaymentSheet,
  }),
}));

import { usePayForOrder } from '@/hooks/usePayment';
import { supabase } from '@/lib/supabase';
import { paymentService } from '@/services/paymentService';
import { act, renderHook } from '@testing-library/react-native';
import type { SupabaseMock } from './helpers/supabase';

const mocked = supabase as unknown as SupabaseMock;

const intent = {
  client_secret: 'pi_secret',
  customer_id: 'cus_1',
  ephemeral_key: 'ek_1',
};

beforeEach(() => {
  jest.clearAllMocks();
  mocked.functions.invoke.mockResolvedValue({ data: intent, error: null });
  mockInitPaymentSheet.mockResolvedValue({ error: undefined });
  mockPresentPaymentSheet.mockResolvedValue({ error: undefined });
});

describe('card payment', () => {
  it('reports success when the sheet completes', async () => {
    const { result } = renderHook(() => usePayForOrder());

    let outcome;
    await act(async () => {
      outcome = await result.current.pay('order-1', 'Pizza Place');
    });

    expect(outcome).toEqual({ status: 'succeeded' });
    expect(mocked.functions.invoke).toHaveBeenCalledWith('create-payment-intent', {
      body: { order_id: 'order-1' },
    });
  });

  it('never sends an amount from the client', async () => {
    const { result } = renderHook(() => usePayForOrder());

    await act(async () => {
      await result.current.pay('order-1', 'Pizza Place');
    });

    const body = mocked.functions.invoke.mock.calls[0][1].body as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['order_id']);
  });

  it('treats a dismissed sheet as cancelled, not as a failure', async () => {
    mockPresentPaymentSheet.mockResolvedValue({ error: { code: 'Canceled', message: 'dismissed' } });
    const { result } = renderHook(() => usePayForOrder());

    let outcome;
    await act(async () => {
      outcome = await result.current.pay('order-1', 'Pizza Place');
    });

    expect(outcome).toEqual({ status: 'cancelled' });
  });

  it('reports a declined card as a failure with the reason', async () => {
    mockPresentPaymentSheet.mockResolvedValue({ error: { code: 'Failed', message: 'Card declined' } });
    const { result } = renderHook(() => usePayForOrder());

    let outcome;
    await act(async () => {
      outcome = await result.current.pay('order-1', 'Pizza Place');
    });

    expect(outcome).toEqual({ status: 'failed', message: 'Card declined' });
  });

  it('fails cleanly when the sheet cannot be initialised', async () => {
    mockInitPaymentSheet.mockResolvedValue({ error: { message: 'Missing key' } });
    const { result } = renderHook(() => usePayForOrder());

    let outcome;
    await act(async () => {
      outcome = await result.current.pay('order-1', 'Pizza Place');
    });

    expect(outcome).toEqual({ status: 'failed', message: 'Missing key' });
    expect(mockPresentPaymentSheet).not.toHaveBeenCalled();
  });

  it('fails cleanly when the intent cannot be created', async () => {
    mocked.functions.invoke.mockResolvedValue({ data: null, error: new Error('function down') });
    const { result } = renderHook(() => usePayForOrder());

    let outcome;
    await act(async () => {
      outcome = await result.current.pay('order-1', 'Pizza Place');
    });

    expect(outcome).toMatchObject({ status: 'failed' });
    expect(mockInitPaymentSheet).not.toHaveBeenCalled();
  });

  it('clears the paying flag after a failure', async () => {
    mockPresentPaymentSheet.mockResolvedValue({ error: { code: 'Failed', message: 'Card declined' } });
    const { result } = renderHook(() => usePayForOrder());

    await act(async () => {
      await result.current.pay('order-1', 'Pizza Place');
    });

    expect(result.current.isPaying).toBe(false);
  });
});

describe('payment intent boundary', () => {
  it('rejects a response without a client secret', async () => {
    mocked.functions.invoke.mockResolvedValue({ data: { customer_id: 'cus_1' }, error: null });

    await expect(paymentService.createIntent('order-1')).rejects.toThrow(
      'The payment could not be started.'
    );
  });

  it('prefers the error the edge function reported', async () => {
    mocked.functions.invoke.mockResolvedValue({
      data: null,
      error: {
        context: { json: () => Promise.resolve({ error: 'Card payments are disabled' }) },
      },
    });

    await expect(paymentService.createIntent('order-1')).rejects.toThrow(
      'Card payments are disabled'
    );
  });
});

describe('cash payment', () => {
  it('does not start a payment sheet, because a cash order is placed immediately', async () => {
    const { result } = renderHook(() => usePayForOrder());

    expect(result.current.isPaying).toBe(false);
    expect(mockInitPaymentSheet).not.toHaveBeenCalled();
    expect(mockPresentPaymentSheet).not.toHaveBeenCalled();
    expect(mocked.functions.invoke).not.toHaveBeenCalled();
  });
});
