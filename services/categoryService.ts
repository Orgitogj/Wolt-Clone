import { supabase } from '@/lib/supabase';
import type { Category } from '@/types/database';

export interface CategoryWithCount extends Category {
  placesCount: number;
}

export const categoryService = {
  
  getAll: async (): Promise<CategoryWithCount[]> => {
    const { data: categories, error } = await supabase
      .from('categories')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) throw error;

    const { data: links, error: linksError } = await supabase
      .from('restaurant_categories')
      .select('category_id');
    if (linksError) throw linksError;

    const counts = new Map<string, number>();
    (links ?? []).forEach((l) => counts.set(l.category_id, (counts.get(l.category_id) ?? 0) + 1));

    return (categories ?? []).map((category) => ({
      ...category,
      placesCount: counts.get(category.id) ?? 0,
    }));
  },
};
