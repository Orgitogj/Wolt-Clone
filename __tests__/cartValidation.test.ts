jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

import {
  CART_MAX_AGE_MS,
  isCartExpired,
  useCartStore,
  type CartItem,
} from '@/hooks/use-cartstore';
import { supabase } from '@/lib/supabase';
import {
  cartValidationService,
  describeCartChanges,
  linesWithMissingAddons,
  needsAcknowledgement,
  removedLines,
  repricedLines,
  toValidationItems,
} from '@/services/cartValidationService';
import type { CartValidation, CartValidationLine, Dish, Restaurant } from '@/types/database';
import type { SupabaseMock } from './helpers/supabase';

const mocked = supabase as unknown as SupabaseMock;

const dish = (overrides: Partial<Dish> = {}): Dish =>
  ({
    id: 'dish-1',
    restaurant_id: 'rest-1',
    name: 'Pizza',
    price: 12,
    is_available: true,
    ...overrides,
  }) as Dish;

const item = (overrides: Partial<CartItem> = {}): CartItem => ({
  id: 'dish-1::',
  dish: dish(),
  selectedAddons: [],
  unitPrice: 12,
  quantity: 1,
  ...overrides,
});

const line = (overrides: Partial<CartValidationLine> = {}): CartValidationLine => ({
  dish_id: 'dish-1',
  dish_name: 'Pizza',
  quantity: 1,
  dish_found: true,
  is_available: true,
  quantity_valid: true,
  base_price: 12,
  unit_price: 12,
  requested_unit_price: 12,
  price_changed: false,
  addons: [],
  missing_addon_ids: [],
  line_total: 12,
  ...overrides,
});

const validation = (overrides: Partial<CartValidation> = {}): CartValidation => ({
  restaurant_id: 'rest-1',
  restaurant_name: 'Kitchen',
  is_open: true,
  min_order: 10,
  currency: 'EUR',
  max_item_quantity: 20,
  subtotal: 12,
  meets_min_order: true,
  has_changes: false,
  lines: [line()],
  ...overrides,
});

const seedCart = (items: CartItem[], updatedAt: number | null = Date.now()) => {
  useCartStore.setState({
    items,
    total: items.reduce((sum, entry) => sum + entry.unitPrice * entry.quantity, 0),
    totalItems: items.reduce((sum, entry) => sum + entry.quantity, 0),
    updatedAt,
    selectedRestaurant: { id: 'rest-1', name: 'Kitchen' } as Restaurant,
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  useCartStore.getState().clearCart();
});

describe('sending the cart for checking', () => {
  it('sends the dish, quantity, add-ons and the price the cart holds', async () => {
    mocked.rpc.mockReturnValue(Promise.resolve({ data: [validation()], error: null }));

    await cartValidationService.validate('rest-1', [
      item({
        selectedAddons: [{ id: 'addon-1', name: 'Cheese', priceDelta: 1.5 }],
        unitPrice: 13.5,
        quantity: 2,
      }),
    ]);

    expect(mocked.rpc).toHaveBeenCalledWith('validate_cart', {
      p_restaurant_id: 'rest-1',
      p_items: [
        { dish_id: 'dish-1', quantity: 2, addon_ids: ['addon-1'], unit_price: 13.5 },
      ],
    });
  });

  it('maps every line of the cart', () => {
    const items = [item(), item({ id: 'dish-2::', dish: dish({ id: 'dish-2' }), quantity: 3 })];

    expect(toValidationItems(items)).toHaveLength(2);
    expect(toValidationItems(items)[1]).toMatchObject({ dish_id: 'dish-2', quantity: 3 });
  });

  it('refuses to invent a result the server did not send', async () => {
    mocked.rpc.mockReturnValue(Promise.resolve({ data: [], error: null }));

    await expect(cartValidationService.validate('rest-1', [item()])).rejects.toThrow(
      /could not check/
    );
  });

  it('passes a refusal straight through', async () => {
    mocked.rpc.mockReturnValue(
      Promise.resolve({ data: null, error: { message: 'Restaurant not found' } })
    );

    await expect(cartValidationService.validate('rest-1', [item()])).rejects.toMatchObject({
      message: 'Restaurant not found',
    });
  });

  it('treats missing lines as an empty list', async () => {
    mocked.rpc.mockReturnValue(
      Promise.resolve({ data: [{ ...validation(), lines: null }], error: null })
    );

    const result = await cartValidationService.validate('rest-1', [item()]);

    expect(result.lines).toEqual([]);
  });

  it('never reads the dishes table directly', async () => {
    mocked.rpc.mockReturnValue(Promise.resolve({ data: [validation()], error: null }));

    await cartValidationService.validate('rest-1', [item()]);

    expect(mocked.from).not.toHaveBeenCalled();
  });
});

describe('what the customer is told', () => {
  it('says nothing when nothing changed', () => {
    expect(describeCartChanges(validation())).toEqual([]);
    expect(needsAcknowledgement(validation())).toBe(false);
  });

  it('names a dish that is gone', () => {
    const result = describeCartChanges(
      validation({
        has_changes: true,
        lines: [line({ is_available: false, dish_name: 'Pizza' })],
      })
    );

    expect(result).toContain('Pizza is no longer available');
  });

  it('names a dish that no longer belongs to the restaurant', () => {
    const result = describeCartChanges(
      validation({
        has_changes: true,
        lines: [line({ dish_found: false, dish_name: null })],
      })
    );

    expect(result).toContain('An item is no longer available');
  });

  it('reports a single price change in the singular', () => {
    const result = describeCartChanges(
      validation({ has_changes: true, lines: [line({ price_changed: true, unit_price: 14 })] })
    );

    expect(result).toContain('A price changed');
  });

  it('reports several price changes in the plural', () => {
    const result = describeCartChanges(
      validation({
        has_changes: true,
        lines: [
          line({ price_changed: true }),
          line({ dish_id: 'dish-2', price_changed: true }),
        ],
      })
    );

    expect(result).toContain('Prices changed');
  });

  it('mentions an extra that is no longer offered', () => {
    const result = describeCartChanges(
      validation({
        has_changes: true,
        lines: [line({ missing_addon_ids: ['addon-1'], dish_name: 'Pizza' })],
      })
    );

    expect(result).toContain('An extra on Pizza is no longer offered');
  });

  it('says when the restaurant is closed', () => {
    const result = describeCartChanges(validation({ has_changes: true, is_open: false }));

    expect(result).toContain('Kitchen is closed right now');
  });

  it('says what the minimum order is', () => {
    const result = describeCartChanges(
      validation({ has_changes: true, meets_min_order: false, min_order: 20 })
    );

    expect(result).toContain('The minimum order is 20.00 EUR');
  });

  it('never mentions a minimum for an empty basket', () => {
    const result = describeCartChanges(
      validation({ has_changes: true, meets_min_order: false, lines: [] })
    );

    expect(result.some((notice) => notice.includes('minimum'))).toBe(false);
  });

  it('never reports a price change on a line that is already gone', () => {
    const changed = validation({
      has_changes: true,
      lines: [line({ is_available: false, price_changed: true })],
    });

    expect(repricedLines(changed)).toHaveLength(0);
    expect(removedLines(changed)).toHaveLength(1);
  });

  it('never reports a missing extra on a line that is already gone', () => {
    const changed = validation({
      has_changes: true,
      lines: [line({ dish_found: false, missing_addon_ids: ['addon-1'] })],
    });

    expect(linesWithMissingAddons(changed)).toHaveLength(0);
  });

  it('says nothing at all without a result', () => {
    expect(describeCartChanges(undefined)).toEqual([]);
    expect(needsAcknowledgement(undefined)).toBe(false);
  });
});

describe('the cart expiring', () => {
  it('treats a fresh cart as current', () => {
    expect(isCartExpired(Date.now())).toBe(false);
  });

  it('treats a cart from just under a day ago as current', () => {
    expect(isCartExpired(Date.now() - (CART_MAX_AGE_MS - 1000))).toBe(false);
  });

  it('treats a cart older than a day as expired', () => {
    expect(isCartExpired(Date.now() - (CART_MAX_AGE_MS + 1000))).toBe(true);
  });

  it('treats a cart that was never touched as current', () => {
    expect(isCartExpired(null)).toBe(false);
  });

  it('clears an expired cart', () => {
    seedCart([item()], Date.now() - (CART_MAX_AGE_MS + 1000));

    const expired = useCartStore.getState().expireIfStale();

    expect(expired).toBe(true);
    expect(useCartStore.getState().items).toHaveLength(0);
    expect(useCartStore.getState().total).toBe(0);
    expect(useCartStore.getState().selectedRestaurant).toBeNull();
  });

  it('keeps a cart that is still current', () => {
    seedCart([item()], Date.now() - 60000);

    const expired = useCartStore.getState().expireIfStale();

    expect(expired).toBe(false);
    expect(useCartStore.getState().items).toHaveLength(1);
  });

  it('stamps the cart when an item is added', () => {
    useCartStore.getState().addItem(dish(), 1);

    expect(useCartStore.getState().updatedAt).not.toBeNull();
  });

  it('refreshes the stamp when the cart changes', () => {
    seedCart([item()], 1000);

    useCartStore.getState().incrementItem('dish-1::');

    expect(useCartStore.getState().updatedAt).toBeGreaterThan(1000);
  });

  it('forgets the stamp once the cart is cleared', () => {
    useCartStore.getState().addItem(dish(), 1);

    useCartStore.getState().clearCart();

    expect(useCartStore.getState().updatedAt).toBeNull();
  });
});

describe('applying what the server said', () => {
  it('moves a line to the new price', () => {
    seedCart([item({ unitPrice: 12 })]);

    useCartStore.getState().applyValidation(
      validation({ lines: [line({ unit_price: 14.5, base_price: 14.5, price_changed: true })] })
    );

    expect(useCartStore.getState().items[0].unitPrice).toBe(14.5);
    expect(useCartStore.getState().items[0].dish.price).toBe(14.5);
    expect(useCartStore.getState().total).toBe(14.5);
  });

  it('removes a line that is no longer available', () => {
    seedCart([item()]);

    useCartStore.getState().applyValidation(
      validation({ lines: [line({ is_available: false })] })
    );

    expect(useCartStore.getState().items).toHaveLength(0);
    expect(useCartStore.getState().selectedRestaurant).toBeNull();
  });

  it('removes a line whose dish is no longer on the menu', () => {
    seedCart([item()]);

    useCartStore.getState().applyValidation(
      validation({ lines: [line({ dish_found: false })] })
    );

    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('keeps the lines the server did not mention', () => {
    seedCart([item(), item({ id: 'dish-2::', dish: dish({ id: 'dish-2' }) })]);

    useCartStore.getState().applyValidation(
      validation({ lines: [line({ is_available: false })] })
    );

    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0].dish.id).toBe('dish-2');
  });

  it('drops an add-on that no longer exists and reprices the line', () => {
    seedCart([
      item({
        selectedAddons: [
          { id: 'addon-1', name: 'Cheese', priceDelta: 1.5 },
          { id: 'addon-2', name: 'Olives', priceDelta: 1 },
        ],
        unitPrice: 14.5,
      }),
    ]);

    useCartStore.getState().applyValidation(
      validation({
        lines: [
          line({
            unit_price: 13,
            base_price: 12,
            requested_unit_price: 14.5,
            price_changed: true,
            missing_addon_ids: ['addon-2'],
          }),
        ],
      })
    );

    const updated = useCartStore.getState().items[0];
    expect(updated.unitPrice).toBe(13);
    expect(updated.selectedAddons.map((addon) => addon.id)).toEqual(['addon-1']);
  });

  it('keeps several lines of the same dish apart by the price they held', () => {
    seedCart([
      item({ id: 'dish-1::a', unitPrice: 12, quantity: 1 }),
      item({ id: 'dish-1::b', unitPrice: 13.5, quantity: 2 }),
    ]);

    useCartStore.getState().applyValidation(
      validation({
        lines: [
          line({ quantity: 1, requested_unit_price: 12, unit_price: 13 }),
          line({ quantity: 2, requested_unit_price: 13.5, unit_price: 15 }),
        ],
      })
    );

    const items = useCartStore.getState().items;
    expect(items[0].unitPrice).toBe(13);
    expect(items[1].unitPrice).toBe(15);
  });

  it('recounts the totals afterwards', () => {
    seedCart([item({ quantity: 3, unitPrice: 12 })]);

    useCartStore.getState().applyValidation(
      validation({ lines: [line({ quantity: 3, unit_price: 10, requested_unit_price: 12 })] })
    );

    expect(useCartStore.getState().total).toBe(30);
    expect(useCartStore.getState().totalItems).toBe(3);
  });

  it('stamps the cart so it does not look stale afterwards', () => {
    seedCart([item()], 1000);

    useCartStore.getState().applyValidation(validation());

    expect(useCartStore.getState().updatedAt).toBeGreaterThan(1000);
  });
});
