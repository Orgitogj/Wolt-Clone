import { supabase } from '@/lib/supabase';
import type {
  AdminActionLog,
  AdminCourier,
  AdminDailyRevenue,
  AdminOrderRow,
  AdminOverview,
  AdminUser,
  CourierDocument,
  Delivery,
  DeliveryWithContext,
  Order,
  OrderStatus,
  PlatformSettings,
  PlatformSettingsPatch,
  Profile,
  RestaurantMember,
  RestaurantMemberRole,
  UserRole,
  VerificationStatus,
} from '@/types/database';

const DELIVERY_CONTEXT = '*, restaurant:restaurants(*), order:orders(*, order_items(*))';

const escapeFilter = (term: string) => term.replace(/[,()*\\]/g, ' ').trim();

export const adminService = {
  getOverview: async (): Promise<AdminOverview | undefined> => {
    const { data, error } = await supabase.from('admin_overview').select('*').maybeSingle();
    if (error) throw error;
    return (data ?? undefined) as AdminOverview | undefined;
  },

  listDailyRevenue: async (): Promise<AdminDailyRevenue[]> => {
    const { data, error } = await supabase.from('admin_daily_revenue').select('*').limit(30);
    if (error) throw error;
    return (data ?? []) as AdminDailyRevenue[];
  },

  listOrders: async (statuses: OrderStatus[], search?: string): Promise<AdminOrderRow[]> => {
    let query = supabase
      .from('admin_orders')
      .select('*')
      .in('status', statuses)
      .order('created_at', { ascending: false })
      .limit(100);

    const term = escapeFilter(search ?? '');
    if (term) {
      query = query.or(
        `restaurant_name.ilike.%${term}%,customer_email.ilike.%${term}%,customer_name.ilike.%${term}%`
      );
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as AdminOrderRow[];
  },

  listCouriers: async (): Promise<AdminCourier[]> => {
    const { data, error } = await supabase
      .from('admin_couriers')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as AdminCourier[];
  },

  listCourierDocuments: async (courierId: string): Promise<CourierDocument[]> => {
    const { data, error } = await supabase
      .from('courier_documents')
      .select('*')
      .eq('courier_id', courierId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as CourierDocument[];
  },

  signDocumentUrl: async (storagePath: string): Promise<string | undefined> => {
    const { data, error } = await supabase.storage
      .from('courier-documents')
      .createSignedUrl(storagePath, 300);
    if (error) throw error;
    return data?.signedUrl;
  },

  listUsers: async (search?: string): Promise<AdminUser[]> => {
    let query = supabase
      .from('admin_users')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    const term = escapeFilter(search ?? '');
    if (term) {
      query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as AdminUser[];
  },

  listUnassignedDeliveries: async (): Promise<DeliveryWithContext[]> => {
    const { data, error } = await supabase
      .from('deliveries')
      .select(DELIVERY_CONTEXT)
      .in('status', ['pending', 'assigned'])
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) throw error;
    return (data ?? []) as unknown as DeliveryWithContext[];
  },

  listActions: async (limit = 50): Promise<AdminActionLog[]> => {
    const { data, error } = await supabase
      .from('admin_actions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as AdminActionLog[];
  },

  listRestaurantMembers: async (restaurantId: string): Promise<RestaurantMember[]> => {
    const { data, error } = await supabase
      .from('restaurant_members')
      .select('*')
      .eq('restaurant_id', restaurantId);
    if (error) throw error;
    return (data ?? []) as RestaurantMember[];
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

  setUserRole: async (userId: string, role: UserRole): Promise<Profile> => {
    const { data, error } = await supabase.rpc('admin_set_user_role', {
      p_user_id: userId,
      p_role: role,
    });
    if (error) throw error;
    return data as Profile;
  },

  reviewCourier: async (
    courierId: string,
    status: VerificationStatus,
    notes?: string | null
  ): Promise<AdminCourier> => {
    const { data, error } = await supabase.rpc('admin_review_courier', {
      p_courier_id: courierId,
      p_status: status,
      p_notes: notes ?? null,
    });
    if (error) throw error;
    return data as AdminCourier;
  },

  reviewCourierDocument: async (
    documentId: string,
    status: VerificationStatus,
    notes?: string | null
  ): Promise<CourierDocument> => {
    const { data, error } = await supabase.rpc('admin_review_courier_document', {
      p_document_id: documentId,
      p_status: status,
      p_notes: notes ?? null,
    });
    if (error) throw error;
    return data as CourierDocument;
  },

  setRestaurantMember: async (
    restaurantId: string,
    userId: string,
    role: RestaurantMemberRole
  ): Promise<RestaurantMember> => {
    const { data, error } = await supabase.rpc('admin_set_restaurant_member', {
      p_restaurant_id: restaurantId,
      p_user_id: userId,
      p_role: role,
    });
    if (error) throw error;
    return data as RestaurantMember;
  },

  removeRestaurantMember: async (restaurantId: string, userId: string): Promise<void> => {
    const { error } = await supabase.rpc('admin_remove_restaurant_member', {
      p_restaurant_id: restaurantId,
      p_user_id: userId,
    });
    if (error) throw error;
  },

  updateSettings: async (patch: PlatformSettingsPatch): Promise<PlatformSettings> => {
    const { data, error } = await supabase.rpc('admin_update_platform_settings', {
      p_patch: patch,
    });
    if (error) throw error;
    return data as PlatformSettings;
  },

  assignDelivery: async (deliveryId: string, courierId: string): Promise<Delivery> => {
    const { data, error } = await supabase.rpc('admin_assign_delivery', {
      p_delivery_id: deliveryId,
      p_courier_id: courierId,
    });
    if (error) throw error;
    return data as Delivery;
  },
};
