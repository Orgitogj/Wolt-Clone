jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

import { supabase } from '@/lib/supabase';
import { orderService } from '@/services/orderService';
import {
  PROMOTION_MESSAGES,
  describePromotion,
  promotionService,
} from '@/services/promotionService';
import type { CartItem } from '@/hooks/use-cartstore';
import type { Dish, Promotion } from '@/types/database';
import type { SupabaseMock } from './helpers/supabase';

const mocked = supabase as unknown as SupabaseMock;

const rpcResult = (data: unknown) => Promise.resolve({ data, error: null });

const promotion = (overrides: Partial<Promotion> = {}): Promotion => ({
  id: 'promo-1',
  code: 'SAVE10',
  description: '10 percent off',
  discount_type: 'percentage',
  discount_value: 10,
  max_discount: null,
  min_subtotal: 0,
  restaurant_id: null,
  starts_at: null,
  ends_at: null,
  max_redemptions: null,
  max_per_customer: 1,
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const cartItem = (): CartItem => ({
  id: 'dish-1::',
  dish: { id: 'dish-1', price: 10 } as Dish,
  selectedAddons: [],
  unitPrice: 10,
  quantity: 2,
});

const baseOrderInput = {
  restaurantId: 'restaurant-1',
  items: [cartItem()],
  deliveryMode: 'delivery' as const,
  addressId: 'address-1',
  scheduledFor: null,
  tipAmount: 0,
  paymentMethod: 'cash' as const,
  leaveAtDoor: false,
  sendAsGift: false,
  idempotencyKey: 'key-1',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('evaluating a code', () => {
  it('asks the server to evaluate the code against the basket', async () => {
    mocked.rpc.mockReturnValue(
      rpcResult([{ valid: true, reason: 'eligible', discount_amount: 2, promotion_id: 'promo-1' }])
    );

    await promotionService.evaluate('save10', 'restaurant-1', 20);

    expect(mocked.rpc).toHaveBeenCalledWith('evaluate_promotion', {
      p_code: 'save10',
      p_restaurant_id: 'restaurant-1',
      p_subtotal: 20,
    });
  });

  it('never computes a discount on the client', async () => {
    mocked.rpc.mockReturnValue(
      rpcResult([{ valid: true, reason: 'eligible', discount_amount: 7.5, promotion_id: 'promo-1' }])
    );

    const result = await promotionService.evaluate('SAVE10', 'restaurant-1', 20);

    expect(result.discount_amount).toBe(7.5);
    expect(mocked.from).not.toHaveBeenCalled();
  });

  it('treats a missing evaluation row as not valid', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    const result = await promotionService.evaluate('SAVE10', 'restaurant-1', 20);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('not_found');
  });

  it('has a customer facing message for every rejection reason', () => {
    const reasons = [
      'not_found',
      'not_signed_in',
      'not_started',
      'expired',
      'wrong_restaurant',
      'below_minimum',
      'fully_redeemed',
      'already_used',
    ] as const;

    reasons.forEach((reason) => {
      expect(PROMOTION_MESSAGES[reason]).toBeTruthy();
      expect(PROMOTION_MESSAGES[reason]).not.toMatch(/error|exception|null/i);
    });
  });
});

describe('sending a code to checkout', () => {
  it('sends only the code, never a discount or a total', async () => {
    mocked.rpc.mockReturnValue(rpcResult({ id: 'order-1' }));

    await orderService.createOrder({ ...baseOrderInput, promoCode: 'SAVE10' });

    const payload = mocked.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.p_promo_code).toBe('SAVE10');
    expect(payload).not.toHaveProperty('p_discount_amount');
    expect(payload).not.toHaveProperty('p_total');
    expect(payload).not.toHaveProperty('p_subtotal');
  });

  it('sends null when no code was applied', async () => {
    mocked.rpc.mockReturnValue(rpcResult({ id: 'order-1' }));

    await orderService.createOrder(baseOrderInput);

    expect(mocked.rpc.mock.calls[0][1]).toMatchObject({ p_promo_code: null });
  });

  it('keeps one idempotency key so a retry cannot redeem the code twice', async () => {
    mocked.rpc.mockReturnValue(rpcResult({ id: 'order-1' }));

    const input = { ...baseOrderInput, promoCode: 'SAVE10', idempotencyKey: 'stable-key' };
    const first = await orderService.createOrder(input);
    const second = await orderService.createOrder(input);

    expect(mocked.rpc.mock.calls[0][1]).toMatchObject({ p_idempotency_key: 'stable-key' });
    expect(mocked.rpc.mock.calls[1][1]).toMatchObject({ p_idempotency_key: 'stable-key' });
    expect(second.id).toBe(first.id);
  });

  it('surfaces a refused code instead of placing an undiscounted order silently', async () => {
    mocked.rpc.mockReturnValue(
      Promise.resolve({ data: null, error: new Error('That promo code has expired') })
    );

    await expect(
      orderService.createOrder({ ...baseOrderInput, promoCode: 'EXPIRED' })
    ).rejects.toThrow('expired');
  });
});

describe('offers', () => {
  it('reads active promotions from the server', async () => {
    mocked.rpc.mockReturnValue(rpcResult([promotion()]));

    const offers = await promotionService.listActive(null);

    expect(mocked.rpc).toHaveBeenCalledWith('active_promotions', { p_restaurant_id: null });
    expect(offers).toHaveLength(1);
  });

  it('scopes offers to a restaurant when asked', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    await promotionService.listActive('restaurant-1');

    expect(mocked.rpc).toHaveBeenCalledWith('active_promotions', {
      p_restaurant_id: 'restaurant-1',
    });
  });

  it('returns an empty list rather than inventing offers', async () => {
    mocked.rpc.mockReturnValue(rpcResult(null));

    const offers = await promotionService.listActive(null);

    expect(offers).toEqual([]);
  });
});

describe('describing a promotion', () => {
  it('describes a percentage discount', () => {
    expect(describePromotion(promotion({ discount_type: 'percentage', discount_value: 15 }))).toBe(
      '15% off'
    );
  });

  it('describes a fixed discount', () => {
    expect(describePromotion(promotion({ discount_type: 'fixed', discount_value: 5 }))).toBe(
      '5.00 € off'
    );
  });

  it('mentions the minimum basket', () => {
    expect(
      describePromotion(promotion({ discount_type: 'fixed', discount_value: 5, min_subtotal: 20 }))
    ).toBe('5.00 € off over 20.00 €');
  });

  it('mentions the discount cap for a percentage promotion', () => {
    expect(
      describePromotion(
        promotion({ discount_type: 'percentage', discount_value: 50, max_discount: 10 })
      )
    ).toBe('50% off up to 10.00 €');
  });
});

describe('admin promotions', () => {
  it('creates a promotion through the admin function', async () => {
    mocked.rpc.mockReturnValue(rpcResult(promotion()));

    await promotionService.save({
      code: 'save10',
      discountType: 'percentage',
      discountValue: 10,
      minSubtotal: 15,
      maxPerCustomer: 2,
    });

    expect(mocked.rpc).toHaveBeenCalledWith('admin_save_promotion', {
      p_id: null,
      p_code: 'save10',
      p_description: null,
      p_discount_type: 'percentage',
      p_discount_value: 10,
      p_max_discount: null,
      p_min_subtotal: 15,
      p_restaurant_id: null,
      p_starts_at: null,
      p_ends_at: null,
      p_max_redemptions: null,
      p_max_per_customer: 2,
      p_is_active: true,
    });
  });

  it('deactivates a promotion through the admin function', async () => {
    mocked.rpc.mockReturnValue(rpcResult(promotion({ is_active: false })));

    await promotionService.setActive('promo-1', false);

    expect(mocked.rpc).toHaveBeenCalledWith('admin_set_promotion_active', {
      p_id: 'promo-1',
      p_is_active: false,
    });
  });

  it('never writes to the promotions table directly', async () => {
    mocked.rpc.mockReturnValue(rpcResult(promotion()));

    await promotionService.save({ code: 'X', discountType: 'fixed', discountValue: 1 });
    await promotionService.setActive('promo-1', true);

    expect(mocked.from).not.toHaveBeenCalled();
  });

  it('propagates a refused admin write', async () => {
    mocked.rpc.mockReturnValue(
      Promise.resolve({ data: null, error: new Error('Administrator access is required') })
    );

    await expect(
      promotionService.save({ code: 'X', discountType: 'fixed', discountValue: 1 })
    ).rejects.toThrow('Administrator access is required');
  });
});
