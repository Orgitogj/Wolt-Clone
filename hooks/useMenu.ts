import { menuService } from '@/services/menuService';
import { useQuery } from '@tanstack/react-query';

export const useMenu = (restaurantId: string) => {
  return useQuery({
    queryKey: ['menu', restaurantId],
    queryFn: () => menuService.getMenu(restaurantId),
    enabled: !!restaurantId,
  });
};

export const useDish = (dishId: string) => {
  return useQuery({
    queryKey: ['dish', dishId],
    queryFn: () => menuService.getDishById(dishId),
    enabled: !!dishId,
  });
};


export const usePopularDishes = (restaurantId: string) => {
  return useQuery({
    queryKey: ['dishes', 'popular', restaurantId],
    queryFn: () => menuService.getPopularDishes(restaurantId),
    enabled: !!restaurantId,
  });
};

export const useDishSearch = (query: string) => {
  return useQuery({
    queryKey: ['dishes', 'search', query],
    queryFn: () => menuService.searchDishes(query),
    enabled: query.trim().length > 0,
  });
};
