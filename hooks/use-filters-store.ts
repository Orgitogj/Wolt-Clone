import type { PriceTier, RestaurantSort } from '@/services/restaurantService';
import { create } from 'zustand';

export const SORT_OPTIONS: RestaurantSort[] = [
  'Recommended',
  'Delivery price',
  'Rating',
  'Delivery time',
];

export const PRICE_TIERS: PriceTier[] = ['€', '€€', '€€€', '€€€€'];

export interface RestaurantFilterState {
  selectedCuisines: string[];
  selectedPrice: PriceTier | null;
  woltPlusOnly: boolean;
  selectedSort: RestaurantSort;
  toggleCuisine: (cuisine: string) => void;
  setSelectedPrice: (price: PriceTier | null) => void;
  setWoltPlusOnly: (value: boolean) => void;
  setSelectedSort: (sort: RestaurantSort) => void;
  clearFilters: () => void;
}

const initialState = {
  selectedCuisines: [] as string[],
  selectedPrice: null as PriceTier | null,
  woltPlusOnly: false,
  selectedSort: 'Recommended' as RestaurantSort,
};

export const useFilterStore = create<RestaurantFilterState>((set) => ({
  ...initialState,
  toggleCuisine: (cuisine) =>
    set((state) => ({
      selectedCuisines: state.selectedCuisines.includes(cuisine)
        ? state.selectedCuisines.filter((item) => item !== cuisine)
        : [...state.selectedCuisines, cuisine],
    })),
  setSelectedPrice: (selectedPrice) => set({ selectedPrice }),
  setWoltPlusOnly: (woltPlusOnly) => set({ woltPlusOnly }),
  setSelectedSort: (selectedSort) => set({ selectedSort }),
  clearFilters: () => set(initialState),
}));
