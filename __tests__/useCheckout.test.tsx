jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

const mockRouter = { push: jest.fn(), dismissTo: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));

const mockAuthState: { user: { id: string } | null } = { user: { id: 'user-a' } };

jest.mock('@/hooks/use-auth-store', () => ({
  __esModule: true,
  default: () => mockAuthState,
}));

const mockClearCart = jest.fn();

const mockCart = {
  items: [
    { dish: { id: 'dish-1', name: 'Pizza', price: 10 }, quantity: 2, addons: [] },
  ] as unknown[],
  total: 20,
  selectedRestaurant: {
    id: 'rest-1',
    name: 'Kitchen',
    address: 'Street 1',
    latitude: 51.9625,
    longitude: 7.6257,
  } as unknown,
  isRestored: true,
};

jest.mock('@/hooks/use-cartstore', () => ({
  useCartContents: () => mockCart,
  useCartStore: (selector: (state: { clearCart: () => void }) => unknown) =>
    selector({ clearCart: mockClearCart }),
}));

const mockAddAddress = jest.fn();

jest.mock('@/hooks/useAddresses', () => ({
  useAddresses: () => ({
    addresses: [
      { id: 'addr-1', label: 'Home', address_line: 'Street 2', latitude: 51.965, longitude: 7.63 },
    ],
    addAddress: mockAddAddress,
  }),
}));

const mockInvalidateOrderHistory = jest.fn();

jest.mock('@/hooks/useOrderHistory', () => ({
  useInvalidateOrderHistory: () => mockInvalidateOrderHistory,
}));

const mockPay = jest.fn();

jest.mock('@/hooks/usePayment', () => ({
  usePayForOrder: () => ({ pay: mockPay, isPaying: false }),
}));

const mockSettings: Record<string, unknown> | undefined = {
  service_fee: 0.99,
  delivery_base_fee: 1.5,
  delivery_base_distance_km: 2,
  delivery_per_km_fee: 0.5,
  fallback_distance_km: 3,
  currency: 'EUR',
  card_payments_enabled: true,
};

const mockSettingsState: { data: Record<string, unknown> | undefined } = { data: mockSettings };

jest.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => mockSettingsState,
}));

const mockCreateOrder = jest.fn();

jest.mock('@/services/orderService', () => {
  const actual = jest.requireActual('@/services/orderService');
  return {
    orderService: {
      ...actual.orderService,
      createOrder: (...args: unknown[]) => mockCreateOrder(...args),
    },
  };
});

import { useCheckout } from '@/hooks/useCheckout';
import { useAddressSelectionStore } from '@/hooks/use-address-store';
import { resetSessionEpochForTests } from '@/utils/sessionGuard';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

type CreateOrderInput = { idempotencyKey: string; paymentMethod: string; tipAmount: number };

const createOrderCalls = (): CreateOrderInput[] =>
  mockCreateOrder.mock.calls.map((call) => call[0] as CreateOrderInput);

const readyToPlace = async (choice: 'standard' | 'schedule' = 'standard') => {
  const view = renderHook(() => useCheckout());
  await act(async () => {
    view.result.current.schedule.chooseStandard();
    await Promise.resolve();
  });
  if (choice === 'schedule') {
    await act(async () => {
      view.result.current.schedule.chooseSchedule();
      await Promise.resolve();
    });
  }
  return view;
};

beforeEach(() => {
  jest.clearAllMocks();
  resetSessionEpochForTests();
  mockAuthState.user = { id: 'user-a' };
  mockCart.isRestored = true;
  mockCart.total = 20;
  mockSettingsState.data = { ...mockSettings };
  useAddressSelectionStore.setState({ selectedAddressId: 'addr-1' });
  mockCreateOrder.mockResolvedValue({ id: 'order-1', status: 'pending' });
  mockPay.mockResolvedValue({ status: 'succeeded' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

describe('fees and totals', () => {
  it('quotes the fees from the platform settings', () => {
    const { result } = renderHook(() => useCheckout());

    expect(result.current.summary.serviceFee).toBe(0.99);
    expect(result.current.summary.deliveryFee).toBe(1.5);
    expect(result.current.summary.grandTotal).toBe(22.49);
    expect(result.current.summary.currency).toBe('€');
  });

  it('charges no fees and refuses the order until the settings arrive', () => {
    mockSettingsState.data = undefined;

    const { result } = renderHook(() => useCheckout());

    expect(result.current.summary.serviceFee).toBe(0);
    expect(result.current.summary.deliveryFee).toBe(0);
    expect(result.current.summary.grandTotal).toBe(20);
    expect(result.current.submission.canPlace).toBe(false);
  });

  it('drops the delivery fee for a pickup order', async () => {
    const { result } = renderHook(() => useCheckout());

    await act(async () => {
      result.current.delivery.setMode('pickup');
      await Promise.resolve();
    });

    expect(result.current.summary.deliveryFee).toBe(0);
    expect(result.current.summary.serviceFee).toBe(0.99);
  });

  it('never shows a negative total when the discount exceeds the basket', () => {
    mockCart.total = 0;

    const { result } = renderHook(() => useCheckout());

    expect(result.current.summary.grandTotal).toBeGreaterThanOrEqual(0);
  });
});

describe('what blocks placing an order', () => {
  it('refuses until a delivery time is chosen', async () => {
    const { result } = renderHook(() => useCheckout());
    expect(result.current.submission.canPlace).toBe(false);

    await act(async () => {
      result.current.schedule.chooseStandard();
      await Promise.resolve();
    });

    expect(result.current.submission.canPlace).toBe(true);
  });

  it('refuses a scheduled order without a chosen slot', async () => {
    const view = await readyToPlace('schedule');

    expect(view.result.current.submission.canPlace).toBe(false);
  });

  it('refuses a delivery order with no address', async () => {
    useAddressSelectionStore.setState({ selectedAddressId: null });

    const view = await readyToPlace();

    expect(view.result.current.submission.canPlace).toBe(false);
  });

  it('allows a pickup order with no address', async () => {
    useAddressSelectionStore.setState({ selectedAddressId: null });

    const view = await readyToPlace();
    await act(async () => {
      view.result.current.delivery.setMode('pickup');
      await Promise.resolve();
    });

    expect(view.result.current.submission.canPlace).toBe(true);
  });

  it('refuses while the basket is still being restored', async () => {
    mockCart.isRestored = false;

    const view = await readyToPlace();

    expect(view.result.current.submission.canPlace).toBe(false);
  });

  it('sends nothing when nobody is signed in', async () => {
    mockAuthState.user = null;

    const view = await readyToPlace();
    await act(async () => {
      await view.result.current.submission.place();
    });

    expect(mockCreateOrder).not.toHaveBeenCalled();
  });
});

describe('the idempotency key', () => {
  it('reuses the key when a double tap submits twice', async () => {
    const view = await readyToPlace();

    await act(async () => {
      await Promise.all([
        view.result.current.submission.place(),
        view.result.current.submission.place(),
      ]);
    });

    const keys = createOrderCalls().map((call) => call.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  it('reuses the key after a failed attempt so a retry cannot double order', async () => {
    mockCreateOrder.mockRejectedValueOnce(new Error('network down'));
    const view = await readyToPlace();

    await act(async () => {
      await view.result.current.submission.place();
    });
    await act(async () => {
      await view.result.current.submission.place();
    });

    const keys = createOrderCalls().map((call) => call.idempotencyKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('reuses the key when the customer cancels the payment sheet', async () => {
    mockCreateOrder.mockResolvedValue({ id: 'order-1', status: 'pending_payment' });
    mockPay.mockResolvedValueOnce({ status: 'cancelled' });
    const view = await readyToPlace();

    await act(async () => {
      await view.result.current.submission.place();
    });
    await act(async () => {
      await view.result.current.submission.place();
    });

    const keys = createOrderCalls().map((call) => call.idempotencyKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('takes a fresh key once an order is placed', async () => {
    const view = await readyToPlace();

    await act(async () => {
      await view.result.current.submission.place();
    });
    await act(async () => {
      await view.result.current.submission.place();
    });

    const keys = createOrderCalls().map((call) => call.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });
});

describe('the cash path', () => {
  it('places the order without reaching the payment sheet', async () => {
    const view = await readyToPlace();
    await act(async () => {
      view.result.current.payment.setMethod('cash');
      await Promise.resolve();
    });

    await act(async () => {
      await view.result.current.submission.place();
    });

    expect(createOrderCalls()[0].paymentMethod).toBe('cash');
    expect(mockPay).not.toHaveBeenCalled();
  });

  it('clears the basket and opens the tracking screen', async () => {
    const view = await readyToPlace();

    await act(async () => {
      await view.result.current.submission.place();
    });

    expect(mockInvalidateOrderHistory).toHaveBeenCalled();
    expect(mockClearCart).toHaveBeenCalled();
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/restaurants');
    expect(mockRouter.push).toHaveBeenCalledWith('/order/track?id=order-1');
  });

  it('labels the button as placing an order', () => {
    const { result } = renderHook(() => useCheckout());

    expect(result.current.submission.label).toBe('Place order · 22.49 €');
  });
});

describe('the card path', () => {
  it('pays through the sheet when the order waits for payment', async () => {
    mockCreateOrder.mockResolvedValue({ id: 'order-2', status: 'pending_payment' });
    const view = await readyToPlace();
    await act(async () => {
      view.result.current.payment.setMethod('card');
      await Promise.resolve();
    });

    await act(async () => {
      await view.result.current.submission.place();
    });

    expect(createOrderCalls()[0].paymentMethod).toBe('card');
    expect(mockPay).toHaveBeenCalledWith('order-2', 'Kitchen');
    expect(mockClearCart).toHaveBeenCalled();
  });

  it('keeps the basket when the payment sheet is cancelled', async () => {
    mockCreateOrder.mockResolvedValue({ id: 'order-2', status: 'pending_payment' });
    mockPay.mockResolvedValue({ status: 'cancelled' });
    const view = await readyToPlace();

    await act(async () => {
      await view.result.current.submission.place();
    });

    expect(mockClearCart).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('Payment cancelled', expect.any(String));
  });

  it('keeps the basket when the payment fails', async () => {
    mockCreateOrder.mockResolvedValue({ id: 'order-2', status: 'pending_payment' });
    mockPay.mockResolvedValue({ status: 'failed', message: 'card declined' });
    const view = await readyToPlace();

    await act(async () => {
      await view.result.current.submission.place();
    });

    expect(mockClearCart).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('Payment failed', 'card declined');
  });

  it('falls back to cash while card payments are switched off', async () => {
    mockSettingsState.data = { ...mockSettings, card_payments_enabled: false };

    const view = await readyToPlace();
    await act(async () => {
      view.result.current.payment.setMethod('card');
      await Promise.resolve();
    });

    expect(view.result.current.payment.method).toBe('cash');
    expect(view.result.current.payment.cardEnabled).toBe(false);

    await act(async () => {
      await view.result.current.submission.place();
    });

    expect(createOrderCalls()[0].paymentMethod).toBe('cash');
  });

  it('labels the button as paying', async () => {
    const view = renderHook(() => useCheckout());
    await act(async () => {
      view.result.current.payment.setMethod('card');
      await Promise.resolve();
    });

    expect(view.result.current.submission.label).toBe('Pay · 22.49 €');
  });
});

describe('when the order is refused', () => {
  it('explains the failure and keeps the basket', async () => {
    mockCreateOrder.mockRejectedValue(new Error('That dish is sold out'));
    const view = await readyToPlace();

    await act(async () => {
      await view.result.current.submission.place();
    });

    expect(Alert.alert).toHaveBeenCalledWith('Order failed', 'That dish is sold out');
    expect(mockClearCart).not.toHaveBeenCalled();
  });

  it('stops showing itself as busy afterwards', async () => {
    mockCreateOrder.mockRejectedValue(new Error('network down'));
    const view = await readyToPlace();

    await act(async () => {
      await view.result.current.submission.place();
    });

    await waitFor(() => expect(view.result.current.submission.isBusy).toBe(false));
  });
});

describe('the tip', () => {
  it('sends the chosen preset with the order', async () => {
    const view = await readyToPlace();
    await act(async () => {
      view.result.current.tip.selectPreset(2);
      await Promise.resolve();
    });

    await act(async () => {
      await view.result.current.submission.place();
    });

    expect(createOrderCalls()[0].tipAmount).toBe(2);
    expect(view.result.current.summary.grandTotal).toBe(24.49);
  });

  it('accepts a custom amount with a comma', async () => {
    const view = await readyToPlace();

    await act(async () => {
      view.result.current.tip.toggleCustom();
      await Promise.resolve();
    });
    await act(async () => {
      view.result.current.tip.setCustomText('3,50');
      await Promise.resolve();
    });
    await act(async () => {
      view.result.current.tip.applyCustom();
      await Promise.resolve();
    });

    expect(view.result.current.tip.amount).toBe(3.5);
    expect(view.result.current.tip.isCustomOpen).toBe(false);
  });

  it('refuses a custom amount that is not a number', async () => {
    const view = await readyToPlace();

    await act(async () => {
      view.result.current.tip.setCustomText('a lot');
      await Promise.resolve();
    });
    await act(async () => {
      view.result.current.tip.applyCustom();
      await Promise.resolve();
    });

    expect(view.result.current.tip.amount).toBe(0);
    expect(Alert.alert).toHaveBeenCalledWith('Invalid amount', expect.any(String));
  });

  it('refuses a negative custom amount', async () => {
    const view = await readyToPlace();

    await act(async () => {
      view.result.current.tip.setCustomText('-5');
      await Promise.resolve();
    });
    await act(async () => {
      view.result.current.tip.applyCustom();
      await Promise.resolve();
    });

    expect(view.result.current.tip.amount).toBe(0);
  });
});

describe('the promo code', () => {
  it('upper cases what the customer types', async () => {
    const view = renderHook(() => useCheckout());

    await act(async () => {
      view.result.current.promo.setInput('save10');
      await Promise.resolve();
    });

    expect(view.result.current.promo.input).toBe('SAVE10');
  });

  it('clears the code when it is removed', async () => {
    const view = renderHook(() => useCheckout());

    await act(async () => {
      view.result.current.promo.setInput('SAVE10');
      await Promise.resolve();
    });
    await act(async () => {
      view.result.current.promo.remove();
      await Promise.resolve();
    });

    expect(view.result.current.promo.input).toBe('');
    expect(view.result.current.promo.applied).toBeNull();
  });
});

describe('the address form', () => {
  it('refuses to save without a label and an address', async () => {
    const view = renderHook(() => useCheckout());

    await act(async () => {
      await view.result.current.address.save();
    });

    expect(mockAddAddress).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('Missing details', expect.any(String));
  });

  it('saves a trimmed address and selects it', async () => {
    mockAddAddress.mockResolvedValue({ id: 'addr-new' });
    const view = renderHook(() => useCheckout());

    await act(async () => {
      view.result.current.address.setLabel('  Home  ');
      view.result.current.address.setDetail('  Street 9  ');
      await Promise.resolve();
    });
    await act(async () => {
      await view.result.current.address.save();
    });

    expect(mockAddAddress).toHaveBeenCalledWith({ label: 'Home', address_line: 'Street 9' });
    expect(useAddressSelectionStore.getState().selectedAddressId).toBe('addr-new');
  });
});
