import type { OrderStatus } from '@/types/database';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: 'Awaiting payment',
  placed: 'Order placed',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready_for_pickup: 'Ready',
  courier_assigned: 'Courier assigned',
  picked_up: 'Picked up',
  delivering: 'On the way',
  delivered: 'Delivered',
  payment_failed: 'Payment failed',
  restaurant_rejected: 'Rejected',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export const ORDER_STATUS_TONES: Record<OrderStatus, 'pending' | 'active' | 'done' | 'failed'> = {
  pending_payment: 'pending',
  placed: 'pending',
  accepted: 'active',
  preparing: 'active',
  ready_for_pickup: 'active',
  courier_assigned: 'active',
  picked_up: 'active',
  delivering: 'active',
  delivered: 'done',
  payment_failed: 'failed',
  restaurant_rejected: 'failed',
  cancelled: 'failed',
  refunded: 'failed',
};

export const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  'delivered',
  'payment_failed',
  'restaurant_rejected',
  'cancelled',
  'refunded',
];

export const MERCHANT_ACTIVE_STATUSES: OrderStatus[] = [
  'placed',
  'accepted',
  'preparing',
  'ready_for_pickup',
  'courier_assigned',
  'picked_up',
  'delivering',
];

export interface MerchantAction {
  to: OrderStatus;
  label: string;
  destructive?: boolean;
  requiresReason?: boolean;
}

export const MERCHANT_ACTIONS: Partial<Record<OrderStatus, MerchantAction[]>> = {
  placed: [
    { to: 'accepted', label: 'Accept' },
    { to: 'restaurant_rejected', label: 'Reject', destructive: true, requiresReason: true },
  ],
  accepted: [
    { to: 'preparing', label: 'Start preparing' },
    { to: 'cancelled', label: 'Cancel', destructive: true, requiresReason: true },
  ],
  preparing: [
    { to: 'ready_for_pickup', label: 'Mark ready' },
    { to: 'cancelled', label: 'Cancel', destructive: true, requiresReason: true },
  ],
  ready_for_pickup: [{ to: 'delivered', label: 'Handed to customer' }],
};

export const isTerminalStatus = (status: OrderStatus): boolean =>
  TERMINAL_ORDER_STATUSES.includes(status);

export const orderStatusLabel = (status: OrderStatus): string =>
  ORDER_STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
