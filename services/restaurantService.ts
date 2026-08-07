import { supabase } from '@/lib/supabase';
import type { Restaurant } from '@/types/database';

export interface RestaurantFilters {
  search?: string;
  categoryId?: string;
  cuisines?: string[];
  sort?: 'Recommended' | 'Delivery price' | 'Rating' | 'Delivery time';
}

function sortRestaurants(restaurants: Restaurant[], sort?: RestaurantFilters['sort']) {
  const sorted = [...restaurants];
  switch (sort) {
    case 'Delivery price':
      return sorted.sort((a, b) => a.delivery_fee - b.delivery_fee);
    case 'Rating':
      return sorted.sort((a, b) => b.rating - a.rating);
    case 'Delivery time':
      return sorted.sort((a, b) => a.delivery_time_min - b.delivery_time_min);
    default:
      return sorted.sort((a, b) => b.rating - a.rating);
  }
}

export const restaurantService = {
  
  getAll: async (filters: RestaurantFilters = {}): Promise<Restaurant[]> => {
    let query = supabase.from('restaurants').select('*');

    if (filters.categoryId) {
      const { data: links, error: linksError } = await supabase
        .from('restaurant_categories')
        .select('restaurant_id')
        .eq('category_id', filters.categoryId);
      if (linksError) throw linksError;
      const ids = (links ?? []).map((l) => l.restaurant_id);
      query = query.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
    }

    if (filters.cuisines?.length) {
      query = query.overlaps('cuisines', filters.cuisines);
    }

    const { data, error } = await query;
    if (error) throw error;

    let results = data ?? [];

    if (filters.search?.trim()) {
      const q = filters.search.trim().toLowerCase();
      results = results.filter((r) => {
        const haystack = [r.name, r.description ?? '', ...r.cuisines, ...r.tags]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    return sortRestaurants(results, filters.sort);
  },

  getById: async (id: string): Promise<Restaurant | undefined> => {
    const { data, error } = await supabase.from('restaurants').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ?? undefined;
  },

  getMarkers: async (): Promise<Restaurant[]> => {
    const { data, error } = await supabase.from('restaurants').select('*');
    if (error) throw error;
    return data ?? [];
  },

  search: async (query: string): Promise<Restaurant[]> => {
    return restaurantService.getAll({ search: query });
  },

  
  getDistinctCuisines: async (): Promise<string[]> => {
    const { data, error } = await supabase.from('restaurants').select('cuisines');
    if (error) throw error;
    const set = new Set<string>();
    (data ?? []).forEach((r) => r.cuisines.forEach((c: string) => set.add(c)));
    return Array.from(set).sort();
  },
};
