import useAuthStore from '@/hooks/use-auth-store';
import { orderService } from '@/services/orderService';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export const useOrderHistory = () => {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: ['orders', user?.id],
    queryFn: () => orderService.getOrderHistory(user!.id),
    enabled: !!user?.id,
  });
};

export const useInvalidateOrderHistory = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['orders', user?.id] });
};
