jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

import type { CartItem } from '@/hooks/use-cartstore';
import { supabase } from '@/lib/supabase';
import { orderService } from '@/services/orderService';
import type { Dish, PlatformSettings } from '@/types/database';
import { createIdempotencyKey } from '@/utils/idempotency';
import type { SupabaseMock } from './helpers/supabase';

const mocked = supabase as unknown as SupabaseMock;

const settings = (overrides: Partial<PlatformSettings> = {}): PlatformSettings =>
  ({
    service_fee: 0.99,
    delivery_base_fee: 1.5,
    delivery_base_distance_km: 2,
    delivery_per_km_fee: 0.5,
    fallback_distance_km: 3,
    currency: 'EUR',
    card_payments_enabled: false,
    ...overrides,
  }) as PlatformSettings;

const cartItem = (overrides: Partial<CartItem> = {}): CartItem => ({
  id: 'dish-1::',
  dish: { id: 'dish-1', price: 10 } as Dish,
  selectedAddons: [],
  unitPrice: 10,
  quantity: 2,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fee calculation', () => {
  it('returns zero fees until platform settings have loaded', () => {
    expect(orderService.calculateFees({ settings: undefined, deliveryMode: 'delivery' })).toEqual({
      serviceFee: 0,
      deliveryFee: 0,
    });
  });

  it('charges no delivery fee for pickup', () => {
    const fees = orderService.calculateFees({ settings: settings(), deliveryMode: 'pickup' });

    expect(fees).toEqual({ serviceFee: 0.99, deliveryFee: 0 });
  });

  it('charges the base fee inside the base distance', () => {
    const fees = orderService.calculateFees({
      settings: settings(),
      deliveryMode: 'delivery',
      distanceKm: 1.5,
    });

    expect(fees.deliveryFee).toBe(1.5);
  });

  it('adds a per kilometre fee beyond the base distance', () => {
    const fees = orderService.calculateFees({
      settings: settings(),
      deliveryMode: 'delivery',
      distanceKm: 6,
    });

    expect(fees.deliveryFee).toBe(3.5);
  });

  it('falls back to the configured distance when the address has no coordinates', () => {
    const fees = orderService.calculateFees({ settings: settings(), deliveryMode: 'delivery' });

    expect(fees.deliveryFee).toBe(2);
  });

  it('rounds fees to cents', () => {
    const fees = orderService.calculateFees({
      settings: settings({ delivery_per_km_fee: 0.333 } as Partial<PlatformSettings>),
      deliveryMode: 'delivery',
      distanceKm: 5.5,
    });

    expect(fees.deliveryFee).toBe(Number(fees.deliveryFee.toFixed(2)));
  });
});

describe('order total', () => {
  it('sums basket, fees and tip the way the checkout screen displays it', () => {
    const basket = 20;
    const { serviceFee, deliveryFee } = orderService.calculateFees({
      settings: settings(),
      deliveryMode: 'delivery',
      distanceKm: 1,
    });
    const tip = 2;

    expect(basket + serviceFee + deliveryFee + tip).toBeCloseTo(24.49, 2);
  });
});

describe('order submission', () => {
  it('sends dish ids and quantities rather than client prices', async () => {
    mocked.rpc.mockReturnValue(Promise.resolve({ data: { id: 'order-1' }, error: null }));

    await orderService.createOrder({
      restaurantId: 'restaurant-1',
      items: [cartItem()],
      deliveryMode: 'delivery',
      addressId: 'address-1',
      scheduledFor: null,
      tipAmount: 1,
      paymentMethod: 'cash',
      leaveAtDoor: false,
      sendAsGift: false,
      idempotencyKey: 'key-1',
    });

    const payload = mocked.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.p_items).toEqual([{ dish_id: 'dish-1', quantity: 2, addon_ids: [] }]);
    expect(JSON.stringify(payload)).not.toContain('unitPrice');
    expect(payload).not.toHaveProperty('p_total');
    expect(payload).not.toHaveProperty('p_subtotal');
  });

  it('reuses one idempotency key so a repeated submission cannot double order', async () => {
    mocked.rpc.mockReturnValue(Promise.resolve({ data: { id: 'order-1' }, error: null }));

    const input = {
      restaurantId: 'restaurant-1',
      items: [cartItem()],
      deliveryMode: 'delivery' as const,
      addressId: 'address-1',
      scheduledFor: null,
      tipAmount: 0,
      paymentMethod: 'cash' as const,
      leaveAtDoor: false,
      sendAsGift: false,
      idempotencyKey: 'stable-key',
    };

    const first = await orderService.createOrder(input);
    const second = await orderService.createOrder(input);

    expect(mocked.rpc.mock.calls[0][1]).toMatchObject({ p_idempotency_key: 'stable-key' });
    expect(mocked.rpc.mock.calls[1][1]).toMatchObject({ p_idempotency_key: 'stable-key' });
    expect(second.id).toBe(first.id);
  });

  it('mints a different key for a genuinely new basket', () => {
    expect(createIdempotencyKey()).not.toBe(createIdempotencyKey());
  });

  it('surfaces a rejected order instead of pretending it succeeded', async () => {
    mocked.rpc.mockReturnValue(
      Promise.resolve({ data: null, error: new Error('Restaurant is closed') })
    );

    await expect(
      orderService.createOrder({
        restaurantId: 'restaurant-1',
        items: [cartItem()],
        deliveryMode: 'delivery',
        addressId: 'address-1',
        scheduledFor: null,
        tipAmount: 0,
        paymentMethod: 'cash',
        leaveAtDoor: false,
        sendAsGift: false,
        idempotencyKey: 'key-2',
      })
    ).rejects.toThrow('Restaurant is closed');
  });
});

describe('distance', () => {
  it('measures the gap between two points in kilometres', () => {
    const km = orderService.calculateDistanceKm(51.9625, 7.6257, 51.9725, 7.6257);

    expect(km).toBeGreaterThan(1);
    expect(km).toBeLessThan(1.3);
  });

  it('is zero for the same point', () => {
    expect(orderService.calculateDistanceKm(51.9625, 7.6257, 51.9625, 7.6257)).toBe(0);
  });
});
