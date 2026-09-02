import { supabase } from '@/lib/supabase';
import type { CartItem } from '@/hooks/use-cartstore';
import type {
  DeliveryMode,
  Order,
  OrderFeeQuote,
  OrderStatusHistoryEntry,
  OrderWithItems,
  PaymentMethod,
  PlatformSettings,
} from '@/types/database';

export interface CreateOrderInput {
  restaurantId: string;
  items: CartItem[];
  deliveryMode: DeliveryMode;
  addressId?: string | null;
  scheduledFor?: string | null;
  tipAmount: number;
  paymentMethod: PaymentMethod;
  leaveAtDoor: boolean;
  sendAsGift: boolean;
  idempotencyKey: string;
}

export interface FeeInput {
  settings: PlatformSettings | undefined;
  deliveryMode: DeliveryMode;
  distanceKm?: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

const round2 = (value: number) => Math.round(value * 100) / 100;

export const orderService = {
  createOrder: async (input: CreateOrderInput): Promise<Order> => {
    const { data, error } = await supabase.rpc('create_order', {
      p_restaurant_id: input.restaurantId,
      p_items: input.items.map((item) => ({
        dish_id: item.dish.id,
        quantity: item.quantity,
        addon_ids: item.selectedAddons.map((addon) => addon.id),
      })),
      p_delivery_mode: input.deliveryMode,
      p_address_id: input.addressId ?? null,
      p_scheduled_for: input.scheduledFor ?? null,
      p_tip_amount: input.tipAmount,
      p_payment_method: input.paymentMethod,
      p_leave_at_door: input.leaveAtDoor,
      p_send_as_gift: input.sendAsGift,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    return data as Order;
  },

  quoteFees: async (
    restaurantId: string,
    deliveryMode: DeliveryMode,
    addressId?: string | null
  ): Promise<OrderFeeQuote> => {
    const { data, error } = await supabase.rpc('quote_order_fees', {
      p_restaurant_id: restaurantId,
      p_delivery_mode: deliveryMode,
      p_address_id: addressId ?? null,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row as OrderFeeQuote;
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

  getOrderById: async (orderId: string): Promise<OrderWithItems | undefined> => {
    const { data, error } = await supabase
      .from('orders')
      .select('*, restaurant:restaurants(*), order_items(*)')
      .eq('id', orderId)
      .maybeSingle();
    if (error) throw error;
    return (data ?? undefined) as unknown as OrderWithItems | undefined;
  },

  getStatusHistory: async (orderId: string): Promise<OrderStatusHistoryEntry[]> => {
    const { data, error } = await supabase
      .from('order_status_history')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as OrderStatusHistoryEntry[];
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

  calculateFees: ({
    settings,
    deliveryMode,
    distanceKm,
  }: FeeInput): { serviceFee: number; deliveryFee: number } => {
    if (!settings) return { serviceFee: 0, deliveryFee: 0 };

    const serviceFee = Number(settings.service_fee);
    if (deliveryMode === 'pickup') {
      return { serviceFee: round2(serviceFee), deliveryFee: 0 };
    }

    const distance = distanceKm ?? Number(settings.fallback_distance_km);
    const base = Number(settings.delivery_base_fee);
    const baseDistance = Number(settings.delivery_base_distance_km);
    const perKm = Number(settings.delivery_per_km_fee);
    const deliveryFee =
      distance <= baseDistance ? base : base + (distance - baseDistance) * perKm;

    return { serviceFee: round2(serviceFee), deliveryFee: round2(deliveryFee) };
  },
};
