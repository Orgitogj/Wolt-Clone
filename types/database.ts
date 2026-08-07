export interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
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

export type OrderStatus = 'placed' | 'confirmed' | 'preparing' | 'on_the_way' | 'delivered' | 'cancelled';
export type DeliveryMode = 'delivery' | 'pickup';
export type PaymentMethod = 'applepay' | 'card';

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
  created_at: string;
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
