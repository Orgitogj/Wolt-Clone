import zustandStorage from '@/utils/zustandStorage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface AddressSelectionStore {
  selectedAddressId: string | null;
  selectAddress: (id: string | null) => void;
}

export const useAddressSelectionStore = create<AddressSelectionStore>()(
  persist(
    (set) => ({
      selectedAddressId: null,
      selectAddress: (id) => set({ selectedAddressId: id }),
    }),
    {
      name: 'selected-address',
      storage: createJSONStorage(() => zustandStorage),
    }
  )
);
