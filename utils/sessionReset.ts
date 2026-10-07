import { useAddressSelectionStore } from '@/hooks/use-address-store';
import { useCartStore } from '@/hooks/use-cartstore';
import { useFilterStore } from '@/hooks/use-filters-store';
import { useScheduleStore } from '@/hooks/use-schedule-store';
import type { QueryClient } from '@tanstack/react-query';

export interface SessionResetOptions {
  preserveCart: boolean;
}

export const resetUserScopedState = async (
  queryClient: QueryClient,
  { preserveCart }: SessionResetOptions
): Promise<void> => {
  await queryClient.cancelQueries();
  queryClient.clear();

  if (!preserveCart) {
    useCartStore.getState().clearCart();
  }

  useAddressSelectionStore.getState().selectAddress(null);
  useScheduleStore.getState().setSelectedSchedule(null);
  useFilterStore.getState().clearFilters();
};
