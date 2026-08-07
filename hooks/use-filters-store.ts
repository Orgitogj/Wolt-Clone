import { create } from 'zustand';

export interface RestaurantFilterState {
  selectedCuisines: string[];
  selectedPrice: string | null;
  woltPlusOnly: boolean;
  selectedSort: string;
  toggleCuisine: (cuisine: string) => void;
  setSelectedPrice: (price: string | null) => void;
  setWoltPlusOnly: (value: boolean) => void;
  setSelectedSort: (sort: string) => void;
  clearFilters: () => void;
}

const initialState = {
  selectedCuisines: [] as string[],
  selectedPrice: null as string | null,
  woltPlusOnly: false,
  selectedSort: 'Recommended',
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
