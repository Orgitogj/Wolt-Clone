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

export interface AdminOrderAction {
  to: OrderStatus;
  label: string;
  destructive?: boolean;
  requiresReason?: boolean;
}

export const ADMIN_ORDER_ACTIONS: Partial<Record<OrderStatus, AdminOrderAction[]>> = {
  pending_payment: [
    { to: 'cancelled', label: 'Cancel', destructive: true, requiresReason: true },
  ],
  placed: [
    { to: 'accepted', label: 'Accept' },
    { to: 'restaurant_rejected', label: 'Reject', destructive: true, requiresReason: true },
    { to: 'cancelled', label: 'Cancel', destructive: true, requiresReason: true },
  ],
  accepted: [
    { to: 'preparing', label: 'Start preparing' },
    { to: 'cancelled', label: 'Cancel', destructive: true, requiresReason: true },
  ],
  preparing: [
    { to: 'ready_for_pickup', label: 'Mark ready' },
    { to: 'cancelled', label: 'Cancel', destructive: true, requiresReason: true },
  ],
  ready_for_pickup: [
    { to: 'delivered', label: 'Mark delivered' },
    { to: 'cancelled', label: 'Cancel', destructive: true, requiresReason: true },
  ],
  courier_assigned: [
    { to: 'picked_up', label: 'Mark picked up' },
    { to: 'cancelled', label: 'Cancel', destructive: true, requiresReason: true },
  ],
  picked_up: [
    { to: 'delivering', label: 'Mark on the way' },
    { to: 'cancelled', label: 'Cancel', destructive: true, requiresReason: true },
  ],
  delivering: [
    { to: 'delivered', label: 'Mark delivered' },
    { to: 'cancelled', label: 'Cancel', destructive: true, requiresReason: true },
  ],
  delivered: [{ to: 'refunded', label: 'Mark refunded', requiresReason: true }],
  cancelled: [{ to: 'refunded', label: 'Mark refunded', requiresReason: true }],
  restaurant_rejected: [{ to: 'refunded', label: 'Mark refunded', requiresReason: true }],
};

export const ADMIN_ORDER_FILTERS: { key: string; label: string; statuses: OrderStatus[] }[] = [
  { key: 'live', label: 'Live', statuses: MERCHANT_ACTIVE_STATUSES },
  { key: 'unpaid', label: 'Unpaid', statuses: ['pending_payment', 'payment_failed'] },
  { key: 'done', label: 'Delivered', statuses: ['delivered'] },
  {
    key: 'problem',
    label: 'Problems',
    statuses: ['restaurant_rejected', 'cancelled', 'refunded', 'payment_failed'],
  },
];
