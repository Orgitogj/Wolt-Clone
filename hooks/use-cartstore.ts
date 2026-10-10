import { useSessionStore } from '@/hooks/use-session-store';
import type {
  CartValidation,
  CartValidationLine,
  Dish,
  Restaurant,
  SelectedAddon,
} from '@/types/database';
import zustandStorage from '@/utils/zustandStorage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const CART_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CartItem {
  id: string;
  dish: Dish;
  selectedAddons: SelectedAddon[];
  unitPrice: number;
  quantity: number;
}

export interface CartStore {
  items: CartItem[];
  selectedRestaurant: Restaurant | null;
  setSelectedRestaurant: (restaurant: Restaurant | null) => void;

  total: number;
  totalItems: number;
  updatedAt: number | null;

  canAddFromRestaurant: (restaurantId: string) => boolean;
  addItem: (dish: Dish, quantity?: number, addons?: SelectedAddon[]) => void;
  removeItem: (itemId: string) => void;
  incrementItem: (itemId: string) => void;
  decrementItem: (itemId: string) => void;
  clearCart: () => void;
  applyValidation: (validation: CartValidation) => void;
  expireIfStale: (now?: number) => boolean;
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

export const isCartExpired = (updatedAt: number | null, now: number = Date.now()): boolean =>
  updatedAt !== null && now - updatedAt > CART_MAX_AGE_MS;

const lineMatchesItem = (line: CartValidationLine, item: CartItem): boolean =>
  line.dish_id === item.dish.id &&
  line.quantity === item.quantity &&
  (line.requested_unit_price === null || line.requested_unit_price === item.unitPrice);

const repriceItem = (item: CartItem, line: CartValidationLine): CartItem => ({
  ...item,
  unitPrice: line.unit_price,
  selectedAddons: item.selectedAddons.filter(
    (addon) => !line.missing_addon_ids.includes(addon.id)
  ),
  dish: { ...item.dish, price: line.base_price },
});

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      total: 0,
      totalItems: 0,
      updatedAt: null,
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
            updatedAt: Date.now(),
          };
        }),

      removeItem: (itemId) =>
        set((state) => {
          const newItems = state.items.filter((item) => item.id !== itemId);
          return {
            items: newItems,
            total: calculateTotal(newItems),
            totalItems: calculateTotalItems(newItems),
            updatedAt: Date.now(),
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
            updatedAt: Date.now(),
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
            updatedAt: Date.now(),
            selectedRestaurant: newItems.length === 0 ? null : state.selectedRestaurant,
          };
        }),

      clearCart: () =>
        set({ items: [], total: 0, totalItems: 0, updatedAt: null, selectedRestaurant: null }),

      applyValidation: (validation) =>
        set((state) => {
          const newItems = state.items.reduce<CartItem[]>((kept, item) => {
            const line =
              validation.lines.find((candidate) => lineMatchesItem(candidate, item)) ??
              validation.lines.find((candidate) => candidate.dish_id === item.dish.id);

            if (!line) return [...kept, item];
            if (!line.dish_found || !line.is_available) return kept;

            return [...kept, repriceItem(item, line)];
          }, []);

          return {
            items: newItems,
            total: calculateTotal(newItems),
            totalItems: calculateTotalItems(newItems),
            updatedAt: Date.now(),
            selectedRestaurant: newItems.length === 0 ? null : state.selectedRestaurant,
          };
        }),

      expireIfStale: (now = Date.now()) => {
        if (!isCartExpired(get().updatedAt, now)) return false;
        get().clearCart();
        return true;
      },
    }),
    {
      name: 'cart',
      storage: createJSONStorage(() => zustandStorage),
      onRehydrateStorage: () => (state) => {
        state?.expireIfStale();
      },
    }
  )
);

export const useCartSummary = () => {
  const isRestored = useSessionStore((state) => state.isRestored);
  const totalItems = useCartStore((state) => state.totalItems);
  const total = useCartStore((state) => state.total);

  return {
    isRestored,
    totalItems: isRestored ? totalItems : 0,
    total: isRestored ? total : 0,
  };
};

export const useCartContents = () => {
  const isRestored = useSessionStore((state) => state.isRestored);
  const items = useCartStore((state) => state.items);
  const total = useCartStore((state) => state.total);
  const selectedRestaurant = useCartStore((state) => state.selectedRestaurant);

  return {
    isRestored,
    items: isRestored ? items : [],
    total: isRestored ? total : 0,
    selectedRestaurant: isRestored ? selectedRestaurant : null,
  };
};
