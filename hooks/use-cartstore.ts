import type { Dish, Restaurant, SelectedAddon } from '@/types/database';
import zustandStorage from '@/utils/zustandStorage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface CartItem {
  id: string;
  dish: Dish;
  selectedAddons: SelectedAddon[];
  unitPrice: number;
  quantity: number;
}

interface CartStore {
  items: CartItem[];
  selectedRestaurant: Restaurant | null;
  setSelectedRestaurant: (restaurant: Restaurant | null) => void;

  total: number;
  totalItems: number;

  canAddFromRestaurant: (restaurantId: string) => boolean;
  addItem: (dish: Dish, quantity?: number, addons?: SelectedAddon[]) => void;
  removeItem: (itemId: string) => void;
  incrementItem: (itemId: string) => void;
  decrementItem: (itemId: string) => void;
  clearCart: () => void;
}

const makeItemId = (dish: Dish, addons: SelectedAddon[]) => {
  const addonKey = addons
    .map((a) => a.id)
    .sort()
    .join(',');
  return `${dish.id}::${addonKey}`;
};

const calculateTotal = (items: CartItem[]): number =>
  items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

const calculateTotalItems = (items: CartItem[]): number =>
  items.reduce((sum, item) => sum + item.quantity, 0);

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      total: 0,
      totalItems: 0,
      selectedRestaurant: null,
      setSelectedRestaurant: (restaurant) => set({ selectedRestaurant: restaurant }),

      canAddFromRestaurant: (restaurantId) => {
        const { selectedRestaurant, items } = get();
        return items.length === 0 || selectedRestaurant?.id === restaurantId;
      },

      addItem: (dish, quantity = 1, addons = []) =>
        set((state) => {
          if (quantity <= 0) return state;
          const itemId = makeItemId(dish, addons);
          const unitPrice = dish.price + addons.reduce((sum, a) => sum + a.priceDelta, 0);
          const existingItem = state.items.find((item) => item.id === itemId);

          const newItems = existingItem
            ? state.items.map((item) =>
                item.id === itemId ? { ...item, quantity: item.quantity + quantity } : item
              )
            : [...state.items, { id: itemId, dish, selectedAddons: addons, unitPrice, quantity }];

          return {
            items: newItems,
            total: calculateTotal(newItems),
            totalItems: calculateTotalItems(newItems),
          };
        }),

      removeItem: (itemId) =>
        set((state) => {
          const newItems = state.items.filter((item) => item.id !== itemId);
          return {
            items: newItems,
            total: calculateTotal(newItems),
            totalItems: calculateTotalItems(newItems),
            selectedRestaurant: newItems.length === 0 ? null : state.selectedRestaurant,
          };
        }),

      incrementItem: (itemId) =>
        set((state) => {
          const newItems = state.items.map((item) =>
            item.id === itemId ? { ...item, quantity: item.quantity + 1 } : item
          );
          return {
            items: newItems,
            total: calculateTotal(newItems),
            totalItems: calculateTotalItems(newItems),
          };
        }),

      decrementItem: (itemId) =>
        set((state) => {
          const existingItem = state.items.find((item) => item.id === itemId);
          if (!existingItem) return state;

          const newItems =
            existingItem.quantity <= 1
              ? state.items.filter((item) => item.id !== itemId)
              : state.items.map((item) =>
                  item.id === itemId ? { ...item, quantity: item.quantity - 1 } : item
                );

          return {
            items: newItems,
            total: calculateTotal(newItems),
            totalItems: calculateTotalItems(newItems),
            selectedRestaurant: newItems.length === 0 ? null : state.selectedRestaurant,
          };
        }),

      clearCart: () => set({ items: [], total: 0, totalItems: 0, selectedRestaurant: null }),
    }),
    {
      name: 'cart',
      storage: createJSONStorage(() => zustandStorage),
    }
  )
);
