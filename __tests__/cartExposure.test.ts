jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

import { useCartContents, useCartStore, useCartSummary } from '@/hooks/use-cartstore';
import { useSessionStore } from '@/hooks/use-session-store';
import type { Dish, Restaurant } from '@/types/database';
import { act, renderHook } from '@testing-library/react-native';

const dish = { id: 'dish-1', price: 10 } as Dish;
const restaurant = { id: 'restaurant-1', name: 'Pizza Place' } as unknown as Restaurant;

const seedCart = () => {
  useCartStore.getState().setSelectedRestaurant(restaurant);
  useCartStore.getState().addItem(dish, 2);
};

beforeEach(() => {
  useCartStore.getState().clearCart();
  useSessionStore.setState({ ownerKey: null, isRestored: false, epoch: 0 });
});

describe('basket exposure before restoration resolves', () => {
  it('hides the basket summary while restoration is unresolved', () => {
    seedCart();

    const { result } = renderHook(() => useCartSummary());

    expect(result.current.isRestored).toBe(false);
    expect(result.current.totalItems).toBe(0);
    expect(result.current.total).toBe(0);
  });

  it('hides basket contents while restoration is unresolved', () => {
    seedCart();

    const { result } = renderHook(() => useCartContents());

    expect(result.current.isRestored).toBe(false);
    expect(result.current.items).toHaveLength(0);
    expect(result.current.total).toBe(0);
    expect(result.current.selectedRestaurant).toBeNull();
  });

  it('shows the basket once restoration resolves', () => {
    seedCart();
    useSessionStore.setState({ isRestored: true });

    const { result } = renderHook(() => useCartContents());

    expect(result.current.items).toHaveLength(1);
    expect(result.current.total).toBe(20);
    expect(result.current.selectedRestaurant?.id).toBe('restaurant-1');
  });

  it('shows the summary once restoration resolves', () => {
    seedCart();
    useSessionStore.setState({ isRestored: true });

    const { result } = renderHook(() => useCartSummary());

    expect(result.current.totalItems).toBe(2);
    expect(result.current.total).toBe(20);
  });

  it('hides the basket again if a later account change reopens restoration', () => {
    seedCart();
    useSessionStore.setState({ isRestored: true });

    const { result, rerender } = renderHook(() => useCartContents());
    expect(result.current.items).toHaveLength(1);

    act(() => {
      useSessionStore.setState({ isRestored: false });
    });
    rerender(undefined);

    expect(result.current.items).toHaveLength(0);
  });

  it('never reports a restaurant from an unresolved basket', () => {
    seedCart();

    const { result } = renderHook(() => useCartContents());

    expect(result.current.selectedRestaurant).toBeNull();
  });
});
