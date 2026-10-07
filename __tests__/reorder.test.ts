jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

import { useCartStore } from '@/hooks/use-cartstore';
import { buildReorderPlan, describeReorderIssue } from '@/services/reorderService';
import type { Dish, DishAddon, OrderItem, Restaurant } from '@/types/database';

const addon = (id: string, name: string, priceDelta: number): DishAddon =>
  ({ id, dish_id: 'dish-1', name, price_delta: priceDelta, sort_order: 0 }) as DishAddon;

const dish = (overrides: Partial<Dish> = {}): Dish =>
  ({
    id: 'dish-1',
    restaurant_id: 'restaurant-1',
    menu_category_id: 'category-1',
    name: 'Margherita',
    description: null,
    price: 10,
    image_url: null,
    is_popular: false,
    is_available: true,
    dietary_tags: [],
    sort_order: 0,
    addons: [],
    ...overrides,
  }) as Dish;

const restaurant = (overrides: Partial<Restaurant> = {}): Restaurant =>
  ({ id: 'restaurant-1', name: 'Pizza Place', is_open: true, ...overrides }) as Restaurant;

const orderItem = (overrides: Partial<OrderItem> = {}): OrderItem =>
  ({
    id: 'item-1',
    order_id: 'order-1',
    dish_id: 'dish-1',
    dish_name: 'Margherita',
    unit_price: 10,
    quantity: 2,
    addons: [],
    line_total: 20,
    ...overrides,
  }) as OrderItem;

beforeEach(() => {
  useCartStore.getState().clearCart();
});

describe('a straightforward reorder', () => {
  it('rebuilds every line at the current price', () => {
    const plan = buildReorderPlan([orderItem()], restaurant(), [dish()]);

    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0].quantity).toBe(2);
    expect(plan.lines[0].unitPrice).toBe(10);
    expect(plan.subtotal).toBe(20);
    expect(plan.canReorder).toBe(true);
    expect(plan.issues).toHaveLength(0);
  });

  it('keeps add-ons that still exist and prices them at today rate', () => {
    const item = orderItem({ addons: [{ id: 'a1', name: 'Extra cheese', priceDelta: 1 }] });
    const current = dish({ addons: [addon('a1', 'Extra cheese', 1.5)] });

    const plan = buildReorderPlan([item], restaurant(), [current]);

    expect(plan.lines[0].addons).toEqual([{ id: 'a1', name: 'Extra cheese', priceDelta: 1.5 }]);
    expect(plan.lines[0].unitPrice).toBe(11.5);
  });
});

describe('changed prices', () => {
  it('reports a dish whose price changed and uses the new one', () => {
    const plan = buildReorderPlan([orderItem({ unit_price: 8 })], restaurant(), [
      dish({ price: 12 }),
    ]);

    expect(plan.priceChanges).toEqual([
      { name: 'Margherita', previousUnitPrice: 8, currentUnitPrice: 12 },
    ]);
    expect(plan.lines[0].unitPrice).toBe(12);
    expect(plan.subtotal).toBe(24);
  });

  it('never reuses the historical price', () => {
    const plan = buildReorderPlan([orderItem({ unit_price: 1 })], restaurant(), [
      dish({ price: 10 }),
    ]);

    expect(plan.subtotal).not.toBe(2);
    expect(plan.subtotal).toBe(20);
  });

  it('reports nothing when the price is unchanged', () => {
    const plan = buildReorderPlan([orderItem()], restaurant(), [dish()]);

    expect(plan.priceChanges).toHaveLength(0);
  });

  it('flags an add-on whose price changed', () => {
    const item = orderItem({ addons: [{ id: 'a1', name: 'Extra cheese', priceDelta: 1 }] });
    const current = dish({ addons: [addon('a1', 'Extra cheese', 2)] });

    const plan = buildReorderPlan([item], restaurant(), [current]);

    expect(plan.issues).toContainEqual({
      name: 'Margherita',
      reason: 'addon_price_changed',
      detail: 'Extra cheese',
    });
  });
});

describe('unavailable items', () => {
  it('omits a dish that left the menu and says so', () => {
    const plan = buildReorderPlan([orderItem()], restaurant(), []);

    expect(plan.lines).toHaveLength(0);
    expect(plan.issues).toEqual([{ name: 'Margherita', reason: 'dish_removed' }]);
    expect(plan.canReorder).toBe(false);
  });

  it('omits a sold out dish and says so', () => {
    const plan = buildReorderPlan([orderItem()], restaurant(), [dish({ is_available: false })]);

    expect(plan.lines).toHaveLength(0);
    expect(plan.issues).toEqual([{ name: 'Margherita', reason: 'dish_unavailable' }]);
  });

  it('keeps the rest of the order when one dish is gone', () => {
    const items = [
      orderItem(),
      orderItem({ id: 'item-2', dish_id: 'dish-2', dish_name: 'Pepperoni' }),
    ];

    const plan = buildReorderPlan(items, restaurant(), [dish()]);

    expect(plan.lines).toHaveLength(1);
    expect(plan.issues).toHaveLength(1);
    expect(plan.canReorder).toBe(true);
  });

  it('drops an add-on that no longer exists and reprices the line', () => {
    const item = orderItem({
      addons: [
        { id: 'a1', name: 'Extra cheese', priceDelta: 1 },
        { id: 'gone', name: 'Truffle', priceDelta: 3 },
      ],
    });
    const current = dish({ addons: [addon('a1', 'Extra cheese', 1)] });

    const plan = buildReorderPlan([item], restaurant(), [current]);

    expect(plan.lines[0].addons).toHaveLength(1);
    expect(plan.lines[0].unitPrice).toBe(11);
    expect(plan.issues).toContainEqual({
      name: 'Margherita',
      reason: 'addon_removed',
      detail: 'Truffle',
    });
  });

  it('explains every issue in words a customer can read', () => {
    const plan = buildReorderPlan([orderItem()], restaurant(), []);

    plan.issues.forEach((issue) => {
      expect(describeReorderIssue(issue)).toMatch(/Margherita/);
      expect(describeReorderIssue(issue)).not.toMatch(/undefined|null/);
    });
  });
});

describe('an unavailable restaurant', () => {
  it('blocks a reorder when the restaurant is gone', () => {
    const plan = buildReorderPlan([orderItem()], null, [dish()]);

    expect(plan.restaurantAvailable).toBe(false);
    expect(plan.canReorder).toBe(false);
  });

  it('blocks a reorder while the restaurant is closed', () => {
    const plan = buildReorderPlan([orderItem()], restaurant({ is_open: false }), [dish()]);

    expect(plan.restaurantOpen).toBe(false);
    expect(plan.canReorder).toBe(false);
  });
});

describe('applying a plan to the basket', () => {
  const applyPlan = (plan: ReturnType<typeof buildReorderPlan>) => {
    const store = useCartStore.getState();
    store.clearCart();
    store.setSelectedRestaurant(plan.restaurant!);
    plan.lines.forEach((line) => store.addItem(line.dish, line.quantity, line.addons));
  };

  it('fills the basket with the current prices', () => {
    const plan = buildReorderPlan([orderItem({ unit_price: 5 })], restaurant(), [
      dish({ price: 10 }),
    ]);

    applyPlan(plan);

    expect(useCartStore.getState().totalItems).toBe(2);
    expect(useCartStore.getState().total).toBe(20);
    expect(useCartStore.getState().selectedRestaurant?.id).toBe('restaurant-1');
  });

  it('replaces a basket that belongs to another restaurant', () => {
    const other = { id: 'restaurant-2', name: 'Other' } as unknown as Restaurant;
    useCartStore.getState().setSelectedRestaurant(other);
    useCartStore.getState().addItem(dish({ id: 'other-dish' }), 1);

    const plan = buildReorderPlan([orderItem()], restaurant(), [dish()]);
    applyPlan(plan);

    expect(useCartStore.getState().selectedRestaurant?.id).toBe('restaurant-1');
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0].dish.id).toBe('dish-1');
  });

  it('leaves the single restaurant rule satisfied afterwards', () => {
    const plan = buildReorderPlan([orderItem()], restaurant(), [dish()]);
    applyPlan(plan);

    expect(useCartStore.getState().canAddFromRestaurant('restaurant-1')).toBe(true);
    expect(useCartStore.getState().canAddFromRestaurant('restaurant-2')).toBe(false);
  });

  it('carries no payment state, promotion or idempotency key into the basket', () => {
    const plan = buildReorderPlan([orderItem()], restaurant(), [dish()]);
    applyPlan(plan);

    const serialised = JSON.stringify(useCartStore.getState());
    expect(serialised).not.toMatch(/idempotency/i);
    expect(serialised).not.toMatch(/promo/i);
    expect(serialised).not.toMatch(/payment/i);
    expect(serialised).not.toMatch(/order_id/i);
  });
});
