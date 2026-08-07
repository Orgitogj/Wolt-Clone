import { supabase } from '@/lib/supabase';
import type { Restaurant } from '@/types/database';

export const favoritesService = {
  list: async (userId: string): Promise<Restaurant[]> => {
    const { data, error } = await supabase
      .from('favorites')
      .select('restaurant:restaurants(*)')
      .eq('user_id', userId);
    if (error) throw error;
    return (data ?? []).map((row: any) => row.restaurant).filter(Boolean);
  },

  add: async (userId: string, restaurantId: string): Promise<void> => {
    const { error } = await supabase
      .from('favorites')
      .insert({ user_id: userId, restaurant_id: restaurantId });
    if (error) throw error;
  },

  remove: async (userId: string, restaurantId: string): Promise<void> => {
    const { error } = await supabase
      .from('favorites')
      .delete()
      .eq('user_id', userId)
      .eq('restaurant_id', restaurantId);
    if (error) throw error;
  },
};
