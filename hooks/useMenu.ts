import { DISH_PAGE_SIZE, menuService } from '@/services/menuService';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

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
  const trimmed = query.trim();

  const search = useInfiniteQuery({
    queryKey: ['dishes', 'search', trimmed],
    queryFn: ({ pageParam }) => menuService.searchDishes(trimmed, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled: trimmed.length > 0,
  });

  const dishes = useMemo(
    () => (search.data?.pages ?? []).flatMap((page) => page.dishes),
    [search.data]
  );

  return { ...search, dishes, pageSize: DISH_PAGE_SIZE };
};
