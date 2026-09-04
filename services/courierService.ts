import { supabase } from '@/lib/supabase';
import { File } from 'expo-file-system';
import { ACTIVE_DELIVERY_STATUSES } from '@/constants/deliveryStatus';
import type {
  Courier,
  CourierAvailability,
  CourierDocument,
  CourierDocumentKind,
  CourierEarning,
  CourierLocation,
  CourierVehicleType,
  Delivery,
  DeliveryCourier,
  DeliveryOfferWithContext,
  DeliveryStatus,
  DeliveryWithContext,
} from '@/types/database';

const DELIVERY_CONTEXT =
  '*, restaurant:restaurants(*), order:orders(*, order_items(*))';

const DOCUMENT_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export interface CourierDocumentUpload {
  uri: string;
  mimeType?: string | null;
}

export interface RegisterCourierInput {
  fullName: string;
  phone?: string | null;
  vehicleType: CourierVehicleType;
  vehiclePlate?: string | null;
}

export const courierService = {
  listDocuments: async (courierId: string): Promise<CourierDocument[]> => {
    const { data, error } = await supabase
      .from('courier_documents')
      .select('*')
      .eq('courier_id', courierId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as CourierDocument[];
  },

  submitDocument: async (
    courierId: string,
    kind: CourierDocumentKind,
    file: CourierDocumentUpload
  ): Promise<CourierDocument> => {
    const contentType = file.mimeType ?? 'image/jpeg';
    const extension = DOCUMENT_EXTENSIONS[contentType] ?? 'jpg';
    const storagePath = `${courierId}/${kind}.${extension}`;
    const bytes = await new File(file.uri).bytes();

    const { error: uploadError } = await supabase.storage
      .from('courier-documents')
      .upload(storagePath, bytes, { contentType, upsert: true });
    if (uploadError) throw uploadError;

    const { data, error } = await supabase.rpc('submit_courier_document', {
      p_kind: kind,
      p_storage_path: storagePath,
    });
    if (error) throw error;
    return data as CourierDocument;
  },

  getProfile: async (userId: string): Promise<Courier | undefined> => {
    const { data, error } = await supabase
      .from('couriers')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    return (data ?? undefined) as Courier | undefined;
  },

  register: async (input: RegisterCourierInput): Promise<Courier> => {
    const { data, error } = await supabase.rpc('register_courier', {
      p_full_name: input.fullName,
      p_phone: input.phone ?? null,
      p_vehicle_type: input.vehicleType,
      p_vehicle_plate: input.vehiclePlate ?? null,
    });
    if (error) throw error;
    return data as Courier;
  },

  setAvailability: async (availability: CourierAvailability): Promise<Courier> => {
    const { data, error } = await supabase.rpc('set_courier_availability', {
      p_availability: availability,
    });
    if (error) throw error;
    return data as Courier;
  },

  recordLocation: async (position: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
  }): Promise<string | null> => {
    const { data, error } = await supabase.rpc('record_courier_location', {
      p_latitude: position.latitude,
      p_longitude: position.longitude,
      p_accuracy_m: position.accuracy ?? null,
      p_heading: position.heading ?? null,
      p_speed_mps: position.speed ?? null,
    });
    if (error) throw error;
    return (data as string | null) ?? null;
  },

  listDeliveryLocations: async (deliveryId: string): Promise<CourierLocation[]> => {
    const { data, error } = await supabase
      .from('courier_locations')
      .select('*')
      .eq('delivery_id', deliveryId)
      .order('recorded_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    return (data ?? []) as CourierLocation[];
  },

  getDeliveryForOrder: async (orderId: string): Promise<Delivery | undefined> => {
    const { data, error } = await supabase
      .from('deliveries')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle();
    if (error) throw error;
    return (data ?? undefined) as Delivery | undefined;
  },

  advanceDispatch: async (): Promise<number> => {
    const { data, error } = await supabase.rpc('advance_dispatch');
    if (error) throw error;
    return (data as number) ?? 0;
  },

  listOffers: async (courierId: string): Promise<DeliveryOfferWithContext[]> => {
    const { data, error } = await supabase
      .from('delivery_offers')
      .select(`*, delivery:deliveries(${DELIVERY_CONTEXT})`)
      .eq('courier_id', courierId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('offered_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as DeliveryOfferWithContext[];
  },

  respondToOffer: async (offerId: string, accept: boolean): Promise<Delivery | null> => {
    const { data, error } = await supabase.rpc('respond_to_delivery_offer', {
      p_offer_id: offerId,
      p_accept: accept,
    });
    if (error) throw error;
    return (data ?? null) as Delivery | null;
  },

  getActiveDelivery: async (courierId: string): Promise<DeliveryWithContext | undefined> => {
    const { data, error } = await supabase
      .from('deliveries')
      .select(DELIVERY_CONTEXT)
      .eq('courier_id', courierId)
      .in('status', ACTIVE_DELIVERY_STATUSES)
      .order('assigned_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data ?? undefined) as unknown as DeliveryWithContext | undefined;
  },

  advanceDelivery: async (deliveryId: string, to: DeliveryStatus): Promise<Delivery> => {
    const { data, error } = await supabase.rpc('courier_advance_delivery', {
      p_delivery_id: deliveryId,
      p_to: to,
    });
    if (error) throw error;
    return data as Delivery;
  },

  listCompletedDeliveries: async (courierId: string): Promise<DeliveryWithContext[]> => {
    const { data, error } = await supabase
      .from('deliveries')
      .select(DELIVERY_CONTEXT)
      .eq('courier_id', courierId)
      .eq('status', 'delivered')
      .order('delivered_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []) as unknown as DeliveryWithContext[];
  },

  listEarnings: async (courierId: string): Promise<CourierEarning[]> => {
    const { data, error } = await supabase
      .from('courier_earnings')
      .select('*')
      .eq('courier_id', courierId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data ?? []) as CourierEarning[];
  },

  getTrackedCourier: async (orderId: string): Promise<DeliveryCourier | undefined> => {
    const { data, error } = await supabase
      .from('delivery_couriers')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle();
    if (error) throw error;
    return (data ?? undefined) as DeliveryCourier | undefined;
  },
};
