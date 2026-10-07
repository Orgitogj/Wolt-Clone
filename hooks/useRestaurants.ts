import {
  RESTAURANT_PAGE_SIZE,
  restaurantService,
  type MapBounds,
  type RestaurantFilters,
} from '@/services/restaurantService';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

export const useRestaurants = (filters: RestaurantFilters = {}) => {
  const query = useInfiniteQuery({
    queryKey: ['restaurants', filters],
    queryFn: ({ pageParam }) => restaurantService.searchPage(filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
  });

  const restaurants = useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.restaurants),
    [query.data]
  );

  return { ...query, restaurants, pageSize: RESTAURANT_PAGE_SIZE };
};

export const useRestaurant = (id: string) => {
  return useQuery({
    queryKey: ['restaurant', id],
    queryFn: () => restaurantService.getById(id),
    enabled: !!id,
  });
};

export const useRestaurantsInBounds = (
  bounds: MapBounds | null,
  filters: RestaurantFilters = {}
) => {
  return useQuery({
    queryKey: ['restaurants-in-bounds', bounds, filters],
    queryFn: () => restaurantService.searchInBounds(bounds!, filters),
    enabled: !!bounds,
    placeholderData: (previous) => previous,
  });
};

export const useCuisines = () => {
  return useQuery({
    queryKey: ['cuisines'],
    queryFn: restaurantService.getDistinctCuisines,
  });
};
