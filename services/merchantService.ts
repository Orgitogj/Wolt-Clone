import { supabase } from '@/lib/supabase';
import type { MerchantOrder, Order, OrderStatus, Restaurant } from '@/types/database';

export const merchantService = {
  listManagedRestaurants: async (userId: string): Promise<Restaurant[]> => {
    const { data, error } = await supabase
      .from('restaurant_members')
      .select('restaurant:restaurants(*)')
      .eq('user_id', userId);
    if (error) throw error;
    return ((data ?? []) as unknown as { restaurant: Restaurant | null }[])
      .map((row) => row.restaurant)
      .filter((restaurant): restaurant is Restaurant => Boolean(restaurant));
  },

  listOrders: async (restaurantId: string, statuses: OrderStatus[]): Promise<MerchantOrder[]> => {
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*), address:addresses(*)')
      .eq('restaurant_id', restaurantId)
      .in('status', statuses)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as MerchantOrder[];
  },

  transitionOrder: async (
    orderId: string,
    to: OrderStatus,
    reason?: string | null
  ): Promise<Order> => {
    const { data, error } = await supabase.rpc('transition_order_status', {
      p_order_id: orderId,
      p_to: to,
      p_reason: reason ?? null,
    });
    if (error) throw error;
    return data as Order;
  },
};
