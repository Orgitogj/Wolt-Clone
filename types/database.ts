export interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  role: UserRole;
  created_at: string;
}

export interface Address {
  id: string;
  user_id: string;
  label: string;
  address_line: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  image_url: string | null;
  background_color: string | null;
  sort_order: number;
}

export interface OpeningHours {
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
  sunday: string;
}

export interface Restaurant {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  rating: number;
  review_count: number;
  delivery_time_min: number;
  delivery_time_max: number;
  delivery_fee: number;
  min_order: number;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  is_open: boolean;
  cuisines: string[];
  tags: string[];
  opening_hours: OpeningHours | null;
  timezone: string | null;
  created_at: string;
}

export interface MenuCategory {
  id: string;
  restaurant_id: string;
  name: string;
  subtitle: string | null;
  sort_order: number;
}

export interface DishAddon {
  id: string;
  dish_id: string;
  name: string;
  price_delta: number;
  sort_order: number;
}

export interface Dish {
  id: string;
  restaurant_id: string;
  menu_category_id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  is_popular: boolean;
  is_available: boolean;
  dietary_tags: string[];
  sort_order: number;
  addons?: DishAddon[];
}

export interface MenuCategoryWithDishes extends MenuCategory {
  dishes: Dish[];
}

export interface Favorite {
  user_id: string;
  restaurant_id: string;
  created_at: string;
}

export type UserRole = 'customer' | 'courier' | 'admin';
export type RestaurantMemberRole = 'owner' | 'manager' | 'staff';
export type OrderActorRole = 'customer' | 'restaurant' | 'courier' | 'admin' | 'system';

export type OrderStatus =
  | 'pending_payment'
  | 'placed'
  | 'accepted'
  | 'preparing'
  | 'ready_for_pickup'
  | 'courier_assigned'
  | 'picked_up'
  | 'delivering'
  | 'delivered'
  | 'payment_failed'
  | 'restaurant_rejected'
  | 'cancelled'
  | 'refunded';

export type DeliveryMode = 'delivery' | 'pickup';
export type PaymentMethod = 'applepay' | 'card' | 'cash';

export interface SelectedAddon {
  id: string;
  name: string;
  priceDelta: number;
}

export interface Order {
  id: string;
  user_id: string;
  restaurant_id: string;
  status: OrderStatus;
  delivery_mode: DeliveryMode;
  address_id: string | null;
  scheduled_for: string | null;
  subtotal: number;
  service_fee: number;
  delivery_fee: number;
  tip_amount: number;
  total: number;
  payment_method: PaymentMethod;
  leave_at_door: boolean;
  send_as_gift: boolean;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  dish_id: string | null;
  dish_name: string;
  unit_price: number;
  quantity: number;
  addons: SelectedAddon[];
  line_total: number;
}

export interface OrderWithItems extends Order {
  restaurant?: Restaurant;
  order_items: OrderItem[];
}

export interface RestaurantMember {
  restaurant_id: string;
  user_id: string;
  role: RestaurantMemberRole;
  created_at: string;
}

export interface RestaurantHours {
  id: string;
  restaurant_id: string;
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  created_at: string;
}

export interface PlatformSettings {
  id: boolean;
  currency: string;
  service_fee: number;
  delivery_base_fee: number;
  delivery_base_distance_km: number;
  delivery_per_km_fee: number;
  fallback_distance_km: number;
  max_delivery_distance_km: number;
  max_tip: number;
  max_item_quantity: number;
  scheduling_grace_minutes: number;
  max_schedule_days_ahead: number;
  default_timezone: string;
  delivery_offer_timeout_seconds: number;
  courier_search_radius_km: number;
  courier_base_fee: number;
  courier_per_km_fee: number;
  max_delivery_offers: number;
  commission_rate: number;
  card_payments_enabled: boolean;
  payment_hold_minutes: number;
  updated_at: string;
}

export interface OrderStatusHistoryEntry {
  id: string;
  order_id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor_id: string | null;
  actor_role: OrderActorRole;
  reason: string | null;
  created_at: string;
}

export interface OrderFeeQuote {
  service_fee: number;
  delivery_fee: number;
  distance_km: number;
}

export interface MerchantOrder extends Order {
  restaurant?: Restaurant;
  order_items: OrderItem[];
  address?: Address | null;
}

export type CourierAvailability = 'offline' | 'online' | 'busy';
export type VerificationStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type CourierVehicleType = 'bicycle' | 'scooter' | 'car' | 'on_foot';
export type CourierDocumentKind =
  | 'id_card'
  | 'drivers_license'
  | 'insurance'
  | 'vehicle_registration';

export type DeliveryStatus =
  | 'pending'
  | 'assigned'
  | 'picked_up'
  | 'delivering'
  | 'delivered'
  | 'cancelled';

export type DeliveryOfferStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

export interface Courier {
  id: string;
  full_name: string;
  phone: string | null;
  vehicle_type: CourierVehicleType;
  vehicle_plate: string | null;
  availability: CourierAvailability;
  verification_status: VerificationStatus;
  verification_notes: string | null;
  current_latitude: number | null;
  current_longitude: number | null;
  location_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CourierDocument {
  id: string;
  courier_id: string;
  kind: CourierDocumentKind;
  storage_path: string;
  status: VerificationStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface Delivery {
  id: string;
  order_id: string;
  restaurant_id: string;
  courier_id: string | null;
  status: DeliveryStatus;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  dropoff_latitude: number | null;
  dropoff_longitude: number | null;
  dropoff_address: string | null;
  distance_km: number | null;
  offer_attempts: number;
  assigned_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeliveryWithContext extends Delivery {
  order?: (Order & { order_items?: OrderItem[] }) | null;
  restaurant?: Restaurant | null;
}

export interface DeliveryOffer {
  id: string;
  delivery_id: string;
  courier_id: string;
  status: DeliveryOfferStatus;
  rank: number;
  distance_km: number | null;
  offered_at: string;
  expires_at: string;
  responded_at: string | null;
}

export interface DeliveryOfferWithContext extends DeliveryOffer {
  delivery?: DeliveryWithContext | null;
}

export interface CourierEarning {
  id: string;
  courier_id: string;
  delivery_id: string;
  base_fee: number;
  distance_fee: number;
  tip: number;
  total: number;
  created_at: string;
}

export interface DeliveryCourier {
  id: string;
  full_name: string;
  vehicle_type: CourierVehicleType;
  current_latitude: number | null;
  current_longitude: number | null;
  location_updated_at: string | null;
  delivery_id: string;
  order_id: string;
}

export type NotificationAudience = 'customer' | 'restaurant' | 'courier';
export type PushPlatform = 'ios' | 'android' | 'web';

export interface CourierLocation {
  id: number;
  courier_id: string;
  delivery_id: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  heading: number | null;
  speed_mps: number | null;
  recorded_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  order_id: string | null;
  delivery_id: string | null;
  audience: NotificationAudience;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  pushed_at: string | null;
  created_at: string;
}

export interface PushToken {
  id: string;
  user_id: string;
  token: string;
  platform: PushPlatform;
  created_at: string;
  last_seen_at: string;
}

export type PaymentStatus =
  | 'requires_payment'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'refunded';

export type LedgerEntryType =
  | 'charge'
  | 'platform_commission'
  | 'restaurant_payout'
  | 'courier_payout'
  | 'refund';

export interface Payment {
  id: string;
  order_id: string;
  user_id: string;
  provider: string;
  provider_intent_id: string | null;
  provider_charge_id: string | null;
  status: PaymentStatus;
  amount: number;
  amount_refunded: number;
  currency: string;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentTransaction {
  id: string;
  payment_id: string;
  provider_event_id: string | null;
  event_type: string;
  status: PaymentStatus;
  amount: number;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface Refund {
  id: string;
  payment_id: string;
  order_id: string;
  provider_refund_id: string | null;
  amount: number;
  reason: string | null;
  requested_by: string | null;
  created_at: string;
}

export interface LedgerEntry {
  id: string;
  order_id: string;
  entry_type: LedgerEntryType;
  party_type: 'customer' | 'restaurant' | 'courier' | 'platform';
  party_id: string | null;
  amount: number;
  currency: string;
  memo: string | null;
  created_at: string;
}

export interface OrderFinancials {
  order_id: string;
  restaurant_id: string;
  user_id: string;
  status: OrderStatus;
  subtotal: number;
  service_fee: number;
  delivery_fee: number;
  tip_amount: number;
  total: number;
  payment_status: string;
  amount_refunded: number;
  collected: number;
  refunded: number;
  restaurant_payout: number;
  courier_payout: number;
  platform_commission: number;
  platform_net: number;
}

export interface PaymentIntentResponse {
  client_secret: string;
  publishable_key: string;
  customer_id: string;
  ephemeral_key: string;
  amount: number;
  currency: string;
}


export interface AdminOverview {
  orders_today: number;
  gmv_today: number;
  commission_today: number;
  refunds_today: number;
  active_orders: number;
  awaiting_payment: number;
  unassigned_deliveries: number;
  pending_couriers: number;
  online_couriers: number;
  total_users: number;
  total_restaurants: number;
}

export interface AdminDailyRevenue {
  day: string;
  orders: number;
  gmv: number;
  commission: number;
}

export interface AdminOrderRow {
  order_id: string;
  created_at: string;
  status: OrderStatus;
  delivery_mode: DeliveryMode;
  payment_method: PaymentMethod;
  subtotal: number;
  tip_amount: number;
  total: number;
  scheduled_for: string | null;
  restaurant_id: string;
  restaurant_name: string;
  customer_id: string;
  customer_name: string | null;
  customer_email: string | null;
  payment_status: string;
  amount_refunded: number;
  delivery_id: string | null;
  delivery_status: DeliveryStatus | null;
  courier_id: string | null;
  courier_name: string | null;
}

export interface AdminCourier {
  id: string;
  full_name: string;
  phone: string | null;
  vehicle_type: CourierVehicleType;
  vehicle_plate: string | null;
  availability: CourierAvailability;
  verification_status: VerificationStatus;
  verification_notes: string | null;
  current_latitude: number | null;
  current_longitude: number | null;
  location_updated_at: string | null;
  created_at: string;
  email: string | null;
  document_count: number;
  approved_documents: number;
  completed_deliveries: number;
  lifetime_earnings: number;
}

export interface AdminUser {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  created_at: string;
  email: string | null;
  order_count: number;
  lifetime_value: number;
  is_courier: boolean;
  managed_restaurants: string[];
}

export interface AdminActionLog {
  id: string;
  admin_id: string | null;
  action: string;
  subject_type: string;
  subject_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export type PlatformSettingsPatch = Partial<
  Omit<PlatformSettings, 'id' | 'updated_at'>
>;
