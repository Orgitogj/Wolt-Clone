import { restaurantService, type RestaurantFilters } from '@/services/restaurantService';
import { useQuery } from '@tanstack/react-query';


export const useRestaurants = (filters: RestaurantFilters = {}) => {
  return useQuery({
    queryKey: ['restaurants', filters],
    queryFn: () => restaurantService.getAll(filters),
  });
};


export const useRestaurant = (id: string) => {
  return useQuery({
    queryKey: ['restaurant', id],
    queryFn: () => restaurantService.getById(id),
    enabled: !!id,
  });
};

export const useRestaurantMarkers = () => {
  return useQuery({
    queryKey: ['restaurant-markers'],
    queryFn: restaurantService.getMarkers,
  });
};

export const useCuisines = () => {
  return useQuery({
    queryKey: ['cuisines'],
    queryFn: restaurantService.getDistinctCuisines,
  });
};
