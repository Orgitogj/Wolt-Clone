import { supabase } from '@/lib/supabase';
import type { Dish, DishAddon, MenuCategory, MenuCategoryWithDishes } from '@/types/database';

type DishRow = Omit<Dish, 'addons'> & { dish_addons: DishAddon[] | null };

type MenuCategoryRow = MenuCategory & { dishes: DishRow[] | null };

export const DISH_PAGE_SIZE = 20;

const sortBySortOrder = <T extends { sort_order: number }>(items: T[]): T[] =>
  [...items].sort((a, b) => a.sort_order - b.sort_order);

const toDish = (row: DishRow): Dish => {
  const { dish_addons, ...dish } = row;
  return { ...dish, addons: sortBySortOrder(dish_addons ?? []) };
};

export const menuService = {
  getMenu: async (restaurantId: string): Promise<MenuCategoryWithDishes[]> => {
    const { data, error } = await supabase
      .from('menu_categories')
      .select('*, dishes(*, dish_addons(*))')
      .eq('restaurant_id', restaurantId);
    if (error) throw error;

    const categories = (data ?? []) as unknown as MenuCategoryRow[];

    return sortBySortOrder(categories).map((category) => {
      const { dishes: dishRows, ...menuCategory } = category;
      const dishes = sortBySortOrder(dishRows ?? [])
        .filter((dish) => dish.is_available)
        .map(toDish);
      return { ...menuCategory, dishes };
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
    return toDish(data as unknown as DishRow);
  },

  getAllDishes: async (restaurantId: string): Promise<Dish[]> => {
    const menu = await menuService.getMenu(restaurantId);
    return menu.flatMap((category) => category.dishes);
  },

  listDishesWithAddons: async (restaurantId: string): Promise<Dish[]> => {
    const { data, error } = await supabase
      .from('dishes')
      .select('*, dish_addons(*)')
      .eq('restaurant_id', restaurantId);
    if (error) throw error;
    return ((data ?? []) as unknown as DishRow[]).map(toDish);
  },

  getPopularDishes: async (restaurantId: string): Promise<Dish[]> => {
    const { data, error } = await supabase
      .from('dishes')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('is_popular', true)
      .eq('is_available', true);
    if (error) throw error;
    return (data ?? []) as Dish[];
  },

  searchDishes: async (
    query: string,
    offset = 0,
    limit = DISH_PAGE_SIZE
  ): Promise<{ dishes: Dish[]; nextOffset: number | null }> => {
    const trimmed = query.trim();
    if (!trimmed) return { dishes: [], nextOffset: null };

    const { data, error } = await supabase.rpc('search_dishes', {
      p_search: trimmed,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw error;

    const dishes = (data ?? []) as Dish[];
    return {
      dishes,
      nextOffset: dishes.length < limit ? null : offset + dishes.length,
    };
  },
};
