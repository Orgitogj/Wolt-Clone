import { supabase } from '@/lib/supabase';
import type { Dish, DishAddon, MenuCategoryWithDishes } from '@/types/database';

const sortBySortOrder = <T extends { sort_order: number }>(items: T[]): T[] =>
  [...items].sort((a, b) => a.sort_order - b.sort_order);

export const menuService = {
  
  getMenu: async (restaurantId: string): Promise<MenuCategoryWithDishes[]> => {
    const { data, error } = await supabase
      .from('menu_categories')
      .select('*, dishes(*, dish_addons(*))')
      .eq('restaurant_id', restaurantId);
    if (error) throw error;

    return sortBySortOrder((data ?? []) as any[]).map((category) => {
      const dishes: Dish[] = sortBySortOrder((category.dishes ?? []) as any[])
        .filter((dish: any) => dish.is_available)
        .map((dish: any) => ({
          ...dish,
          addons: sortBySortOrder((dish.dish_addons ?? []) as DishAddon[]),
        }));
      return { ...category, dishes };
    });
  },

  
  getDishById: async (dishId: string): Promise<Dish | undefined> => {
    const { data, error } = await supabase
      .from('dishes')
      .select('*, dish_addons(*)')
      .eq('id', dishId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return undefined;

    const { dish_addons, ...dish } = data as any;
    return { ...dish, addons: sortBySortOrder((dish_addons ?? []) as DishAddon[]) };
  },

  
  getAllDishes: async (restaurantId: string): Promise<Dish[]> => {
    const menu = await menuService.getMenu(restaurantId);
    return menu.flatMap((category) => category.dishes);
  },

  
  getPopularDishes: async (restaurantId: string): Promise<Dish[]> => {
    const { data, error } = await supabase
      .from('dishes')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('is_popular', true)
      .eq('is_available', true);
    if (error) throw error;
    return data ?? [];
  },

  
  searchDishes: async (query: string): Promise<Dish[]> => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const { data, error } = await supabase.from('dishes').select('*').eq('is_available', true);
    if (error) throw error;
    return (data ?? []).filter((dish) =>
      `${dish.name} ${dish.description ?? ''}`.toLowerCase().includes(q)
    );
  },
};
