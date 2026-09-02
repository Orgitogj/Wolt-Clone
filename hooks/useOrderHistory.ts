import useAuthStore from '@/hooks/use-auth-store';
import { useRealtimeTable } from '@/hooks/useRealtime';
import { orderService } from '@/services/orderService';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export const useOrderHistory = () => {
  const { user } = useAuthStore();
  const userId = user?.id;

  useRealtimeTable({
    channel: `orders-${userId ?? 'anon'}`,
    table: 'orders',
    filter: userId ? `user_id=eq.${userId}` : undefined,
    enabled: !!userId,
    invalidate: [['orders', userId]],
  });

  return useQuery({
    queryKey: ['orders', userId],
    queryFn: () => orderService.getOrderHistory(userId!),
    enabled: !!userId,
  });
};

export const useInvalidateOrderHistory = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['orders', user?.id] });
};
