import { supabase } from '@/lib/supabase';
import type { Restaurant } from '@/types/database';

export type RestaurantSort = 'Recommended' | 'Delivery price' | 'Rating' | 'Delivery time';

export type PriceTier = '€' | '€€' | '€€€' | '€€€€';

export interface RestaurantFilters {
  search?: string;
  categoryId?: string;
  cuisines?: string[];
  priceTier?: PriceTier | null;
  woltPlusOnly?: boolean;
  sort?: RestaurantSort;
}

export interface MapBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface RestaurantPage {
  restaurants: Restaurant[];
  nextOffset: number | null;
}

export const RESTAURANT_PAGE_SIZE = 20;

export const restaurantService = {
  searchPage: async (
    filters: RestaurantFilters = {},
    offset = 0,
    limit = RESTAURANT_PAGE_SIZE
  ): Promise<RestaurantPage> => {
    const { data, error } = await supabase.rpc('search_restaurants', {
      p_search: filters.search?.trim() || null,
      p_category_id: filters.categoryId ?? null,
      p_cuisines: filters.cuisines?.length ? filters.cuisines : null,
      p_price_tier: filters.priceTier ?? null,
      p_wolt_plus_only: filters.woltPlusOnly ?? false,
      p_sort: filters.sort ?? 'Recommended',
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw error;

    const restaurants = (data ?? []) as Restaurant[];
    return {
      restaurants,
      nextOffset: restaurants.length < limit ? null : offset + restaurants.length,
    };
  },

  searchInBounds: async (
    bounds: MapBounds,
    filters: RestaurantFilters = {},
    limit = 50
  ): Promise<Restaurant[]> => {
    const { data, error } = await supabase.rpc('search_restaurants_in_bounds', {
      p_min_lat: bounds.minLat,
      p_min_lng: bounds.minLng,
      p_max_lat: bounds.maxLat,
      p_max_lng: bounds.maxLng,
      p_cuisines: filters.cuisines?.length ? filters.cuisines : null,
      p_price_tier: filters.priceTier ?? null,
      p_wolt_plus_only: filters.woltPlusOnly ?? false,
      p_sort: filters.sort ?? 'Recommended',
      p_limit: limit,
    });
    if (error) throw error;
    return (data ?? []) as Restaurant[];
  },

  getById: async (id: string): Promise<Restaurant | undefined> => {
    const { data, error } = await supabase.from('restaurants').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ?? undefined;
  },

  getDistinctCuisines: async (): Promise<string[]> => {
    const { data, error } = await supabase.rpc('distinct_cuisines');
    if (error) throw error;
    return ((data ?? []) as { cuisine: string }[]).map((row) => row.cuisine).filter(Boolean);
  },
};
