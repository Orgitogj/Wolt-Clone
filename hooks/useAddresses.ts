import useAuthStore from '@/hooks/use-auth-store';
import { addressService, type NewAddress } from '@/services/addressService';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const useAddresses = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const userId = user?.id;

  const query = useQuery({
    queryKey: ['addresses', userId],
    queryFn: () => addressService.list(userId!),
    enabled: !!userId,
  });

  const addAddress = useMutation({
    mutationFn: (address: NewAddress) => addressService.add(userId!, address),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['addresses', userId] }),
  });

  const removeAddress = useMutation({
    mutationFn: (addressId: string) => addressService.remove(addressId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['addresses', userId] }),
  });

  return {
    addresses: query.data ?? [],
    isLoading: query.isLoading,
    addAddress: addAddress.mutateAsync,
    removeAddress: removeAddress.mutateAsync,
  };
};
