import { useCartStore } from '@/hooks/use-cartstore';
import { reorderService, type ReorderPlan } from '@/services/reorderService';
import type { OrderWithItems } from '@/types/database';
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

export const useReorderPlan = (order: OrderWithItems | undefined) =>
  useQuery({
    queryKey: ['reorder-plan', order?.id],
    queryFn: () => reorderService.planFor(order!),
    enabled: !!order?.id,
    staleTime: 0,
    gcTime: 0,
  });

export interface ReorderConflict {
  hasConflict: boolean;
  currentRestaurantName: string | null;
}

export const useApplyReorder = () => {
  const items = useCartStore((state) => state.items);
  const selectedRestaurant = useCartStore((state) => state.selectedRestaurant);

  const conflictFor = useCallback(
    (plan: ReorderPlan): ReorderConflict => {
      const hasConflict =
        items.length > 0 && !!plan.restaurant && selectedRestaurant?.id !== plan.restaurant.id;

      return {
        hasConflict,
        currentRestaurantName: selectedRestaurant?.name ?? null,
      };
    },
    [items.length, selectedRestaurant]
  );

  const apply = useCallback((plan: ReorderPlan) => {
    if (!plan.canReorder || !plan.restaurant) return false;

    const store = useCartStore.getState();
    store.clearCart();
    store.setSelectedRestaurant(plan.restaurant);

    plan.lines.forEach((line) => {
      store.addItem(line.dish, line.quantity, line.addons);
    });

    return true;
  }, []);

  return { conflictFor, apply };
};
