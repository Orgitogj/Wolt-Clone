jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

import { useAddressSelectionStore } from '@/hooks/use-address-store';
import { consumeCartCarryOver, markCartCarryOver } from '@/hooks/use-auth-store';
import { useCartStore } from '@/hooks/use-cartstore';
import { useFilterStore } from '@/hooks/use-filters-store';
import { useScheduleStore } from '@/hooks/use-schedule-store';
import type { Dish, Restaurant, SelectedAddon } from '@/types/database';
import { resetUserScopedState } from '@/utils/sessionReset';
import { QueryClient } from '@tanstack/react-query';

const dish = (overrides: Partial<Dish> = {}): Dish =>
  ({
    id: 'dish-1',
    restaurant_id: 'restaurant-1',
    menu_category_id: 'category-1',
    name: 'Margherita',
    description: 'Tomato and mozzarella',
    price: 10,
    image_url: null,
    is_popular: false,
    is_available: true,
    dietary_tags: [],
    sort_order: 0,
    ...overrides,
  }) as Dish;

const restaurant = (id = 'restaurant-1'): Restaurant =>
  ({ id, name: 'Pizza Place', cuisines: [], tags: [] }) as unknown as Restaurant;

const addon = (id: string, priceDelta: number): SelectedAddon =>
  ({ id, name: id, priceDelta }) as SelectedAddon;

const resetStores = () => {
  useCartStore.getState().clearCart();
  useAddressSelectionStore.getState().selectAddress(null);
  useScheduleStore.getState().setSelectedSchedule(null);
  useFilterStore.getState().clearFilters();
};

beforeEach(() => {
  resetStores();
  consumeCartCarryOver('reset');
});

describe('cart totals', () => {
  it('adds a dish and derives total and item count', () => {
    useCartStore.getState().addItem(dish(), 2);

    const state = useCartStore.getState();
    expect(state.items).toHaveLength(1);
    expect(state.totalItems).toBe(2);
    expect(state.total).toBe(20);
  });

  it('prices add-ons into the unit price', () => {
    useCartStore.getState().addItem(dish(), 1, [addon('extra-cheese', 1.5)]);

    expect(useCartStore.getState().total).toBe(11.5);
  });

  it('merges identical dish and add-on combinations', () => {
    const addons = [addon('extra-cheese', 1.5)];
    useCartStore.getState().addItem(dish(), 1, addons);
    useCartStore.getState().addItem(dish(), 2, addons);

    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().totalItems).toBe(3);
  });

  it('keeps different add-on combinations as separate lines', () => {
    useCartStore.getState().addItem(dish(), 1, [addon('extra-cheese', 1.5)]);
    useCartStore.getState().addItem(dish(), 1, [addon('olives', 0.5)]);

    expect(useCartStore.getState().items).toHaveLength(2);
    expect(useCartStore.getState().total).toBe(22);
  });

  it('ignores non positive quantities', () => {
    useCartStore.getState().addItem(dish(), 0);

    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('drops the line and the restaurant when the last item is decremented away', () => {
    const store = useCartStore.getState();
    store.setSelectedRestaurant(restaurant());
    store.addItem(dish(), 1);

    const itemId = useCartStore.getState().items[0].id;
    useCartStore.getState().decrementItem(itemId);

    expect(useCartStore.getState().items).toHaveLength(0);
    expect(useCartStore.getState().total).toBe(0);
    expect(useCartStore.getState().selectedRestaurant).toBeNull();
  });
});

describe('single restaurant rule', () => {
  it('allows any restaurant while the cart is empty', () => {
    expect(useCartStore.getState().canAddFromRestaurant('restaurant-2')).toBe(true);
  });

  it('rejects a second restaurant once the cart has items', () => {
    const store = useCartStore.getState();
    store.setSelectedRestaurant(restaurant('restaurant-1'));
    store.addItem(dish(), 1);

    expect(useCartStore.getState().canAddFromRestaurant('restaurant-1')).toBe(true);
    expect(useCartStore.getState().canAddFromRestaurant('restaurant-2')).toBe(false);
  });
});

describe('account transitions', () => {
  const seedUserState = () => {
    const store = useCartStore.getState();
    store.setSelectedRestaurant(restaurant());
    store.addItem(dish(), 2);
    useAddressSelectionStore.getState().selectAddress('address-1');
    useScheduleStore.getState().setSelectedSchedule({
      day: 'Monday',
      time: '18:00',
      isoTimestamp: '2026-01-01T18:00:00.000Z',
    });
    useFilterStore.getState().toggleCuisine('Italian');
  };

  it('clears every user scoped store and the query cache on sign out', async () => {
    seedUserState();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    });
    queryClient.setQueryData(['orders', 'user-a'], [{ id: 'order-1' }]);

    await resetUserScopedState(queryClient, { preserveCart: false });

    expect(useCartStore.getState().items).toHaveLength(0);
    expect(useCartStore.getState().total).toBe(0);
    expect(useCartStore.getState().selectedRestaurant).toBeNull();
    expect(useAddressSelectionStore.getState().selectedAddressId).toBeNull();
    expect(useScheduleStore.getState().selectedSchedule).toBeNull();
    expect(useFilterStore.getState().selectedCuisines).toEqual([]);
    expect(queryClient.getQueryData(['orders', 'user-a'])).toBeUndefined();
  });

  it('keeps the basket but drops the rest when a guest upgrades to an account', async () => {
    seedUserState();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    });
    queryClient.setQueryData(['profile', 'anon-user'], { full_name: 'Guest' });

    await resetUserScopedState(queryClient, { preserveCart: true });

    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().total).toBe(20);
    expect(useAddressSelectionStore.getState().selectedAddressId).toBeNull();
    expect(queryClient.getQueryData(['profile', 'anon-user'])).toBeUndefined();
  });
});

describe('guest upgrade intent', () => {
  it('only carries the basket over for the account that was marked', () => {
    markCartCarryOver('anon-user');

    expect(consumeCartCarryOver('someone-else')).toBe(false);
  });

  it('matches the marked anonymous account exactly once', () => {
    markCartCarryOver('anon-user');

    expect(consumeCartCarryOver('anon-user')).toBe(true);
    expect(consumeCartCarryOver('anon-user')).toBe(false);
  });

  it('does not carry anything over when no upgrade was started', () => {
    expect(consumeCartCarryOver('anon-user')).toBe(false);
  });

  it('never carries over from a signed out state', () => {
    markCartCarryOver('anon-user');

    expect(consumeCartCarryOver(null)).toBe(false);
  });
});
