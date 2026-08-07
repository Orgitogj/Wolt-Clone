import useAuthStore from '@/hooks/use-auth-store';
import { favoritesService } from '@/services/favoritesService';
import type { Restaurant } from '@/types/database';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const useFavorites = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const userId = user?.id;

  const query = useQuery({
    queryKey: ['favorites', userId],
    queryFn: () => favoritesService.list(userId!),
    enabled: !!userId,
  });

  const favorites = query.data ?? [];
  const isFavorite = (restaurantId: string) => favorites.some((r) => r.id === restaurantId);

  const toggleFavorite = useMutation({
    mutationFn: async (restaurant: Restaurant) => {
      if (!userId) throw new Error('Not signed in');
      if (isFavorite(restaurant.id)) {
        await favoritesService.remove(userId, restaurant.id);
      } else {
        await favoritesService.add(userId, restaurant.id);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['favorites', userId] }),
  });

  return {
    favorites,
    isLoading: query.isLoading,
    isFavorite,
    toggleFavorite: toggleFavorite.mutate,
  };
};
