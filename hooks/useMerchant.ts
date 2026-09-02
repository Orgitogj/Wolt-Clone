import useAuthStore from '@/hooks/use-auth-store';
import { MERCHANT_ACTIVE_STATUSES } from '@/constants/orderStatus';
import { useRealtimeTable } from '@/hooks/useRealtime';
import { merchantService } from '@/services/merchantService';
import type { OrderStatus } from '@/types/database';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const useManagedRestaurants = () => {
  const { user } = useAuthStore();
  const userId = user?.id;

  const query = useQuery({
    queryKey: ['managed-restaurants', userId],
    queryFn: () => merchantService.listManagedRestaurants(userId!),
    enabled: !!userId,
    staleTime: 1000 * 60 * 10,
  });

  return {
    restaurants: query.data ?? [],
    isLoading: query.isLoading,
    isMerchant: (query.data ?? []).length > 0,
  };
};

export const useMerchantOrders = (restaurantId: string | undefined, showHistory = false) => {
  const statuses: OrderStatus[] = showHistory
    ? ['delivered', 'cancelled', 'restaurant_rejected', 'refunded']
    : MERCHANT_ACTIVE_STATUSES;

  useRealtimeTable({
    channel: `merchant-orders-${restaurantId ?? 'none'}`,
    table: 'orders',
    filter: restaurantId ? `restaurant_id=eq.${restaurantId}` : undefined,
    enabled: !!restaurantId,
    invalidate: [['merchant-orders', restaurantId, showHistory]],
  });

  return useQuery({
    queryKey: ['merchant-orders', restaurantId, showHistory],
    queryFn: () => merchantService.listOrders(restaurantId!, statuses),
    enabled: !!restaurantId,
  });
};

export const useTransitionOrder = (restaurantId: string | undefined) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      orderId,
      to,
      reason,
    }: {
      orderId: string;
      to: OrderStatus;
      reason?: string | null;
    }) => merchantService.transitionOrder(orderId, to, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant-orders', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
};
