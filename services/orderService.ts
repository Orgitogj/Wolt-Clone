import { supabase } from '@/lib/supabase';
import type { CartItem } from '@/hooks/use-cartstore';
import type { DeliveryMode, OrderWithItems, PaymentMethod } from '@/types/database';

export interface CreateOrderInput {
  userId: string;
  restaurantId: string;
  items: CartItem[];
  deliveryMode: DeliveryMode;
  addressId?: string | null;
  scheduledFor?: string | null;
  tipAmount: number;
  paymentMethod: PaymentMethod;
  leaveAtDoor: boolean;
  sendAsGift: boolean;
  subtotal: number;
  serviceFee: number;
  deliveryFee: number;
  total: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

export const orderService = {
  
  createOrder: async (input: CreateOrderInput): Promise<{ orderId: string }> => {
    const { data: order, error } = await supabase
      .from('orders')
      .insert({
        user_id: input.userId,
        restaurant_id: input.restaurantId,
        status: 'placed',
        delivery_mode: input.deliveryMode,
        address_id: input.addressId ?? null,
        scheduled_for: input.scheduledFor ?? null,
        subtotal: input.subtotal,
        service_fee: input.serviceFee,
        delivery_fee: input.deliveryFee,
        tip_amount: input.tipAmount,
        total: input.total,
        payment_method: input.paymentMethod,
        leave_at_door: input.leaveAtDoor,
        send_as_gift: input.sendAsGift,
      })
      .select()
      .single();
    if (error) throw error;

    const orderItems = input.items.map((item) => ({
      order_id: order.id,
      dish_id: item.dish.id,
      dish_name: item.dish.name,
      unit_price: item.unitPrice,
      quantity: item.quantity,
      addons: item.selectedAddons,
      line_total: item.unitPrice * item.quantity,
    }));

    const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
    if (itemsError) throw itemsError;

    return { orderId: order.id };
  },

  getOrderHistory: async (userId: string): Promise<OrderWithItems[]> => {
    const { data, error } = await supabase
      .from('orders')
      .select('*, restaurant:restaurants(*), order_items(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as OrderWithItems[];
  },

  calculateDistanceKm: (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  
  calculateFees: (
    cartTotal: number,
    distanceKm: number = 2.5
  ): { serviceFee: number; deliveryFee: number } => {
    const serviceFee = 0.83;
    const deliveryFee = distanceKm <= 3 ? 1.9 : 1.9 + (distanceKm - 3) * 0.5;

    return {
      serviceFee: Number(serviceFee.toFixed(2)),
      deliveryFee: Number(deliveryFee.toFixed(2)),
    };
  },
};
