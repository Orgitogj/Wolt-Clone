jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

import { OrderStatusBadge } from '@/components/OrderStatusBadge';
import {
  ADMIN_ORDER_ACTIONS,
  MERCHANT_ACTIONS,
  MERCHANT_ACTIVE_STATUSES,
  isTerminalStatus,
  orderStatusLabel,
} from '@/constants/orderStatus';
import type { OrderStatus } from '@/types/database';
import { render, screen } from '@testing-library/react-native';

describe('terminal statuses', () => {
  it.each<OrderStatus>(['delivered', 'cancelled', 'refunded', 'restaurant_rejected', 'payment_failed'])(
    'treats %s as finished',
    (status) => {
      expect(isTerminalStatus(status)).toBe(true);
    }
  );

  it.each<OrderStatus>(['placed', 'accepted', 'preparing', 'delivering', 'pending_payment'])(
    'treats %s as still in flight',
    (status) => {
      expect(isTerminalStatus(status)).toBe(false);
    }
  );

  it('offers no merchant action once an order is finished', () => {
    expect(MERCHANT_ACTIONS.delivered).toBeUndefined();
    expect(MERCHANT_ACTIONS.cancelled).toBeUndefined();
    expect(MERCHANT_ACTIONS.refunded).toBeUndefined();
  });
});

describe('role sensitive actions', () => {
  it('lets a merchant accept or reject a newly placed order', () => {
    const actions = MERCHANT_ACTIONS.placed ?? [];

    expect(actions.map((action) => action.to)).toEqual(['accepted', 'restaurant_rejected']);
  });

  it('never lets a merchant move an order straight to delivered from placed', () => {
    const actions = MERCHANT_ACTIONS.placed ?? [];

    expect(actions.some((action) => action.to === 'delivered')).toBe(false);
  });

  it('never lets a merchant touch an unpaid order', () => {
    expect(MERCHANT_ACTIONS.pending_payment).toBeUndefined();
  });

  it('gives admins strictly more power than merchants on a placed order', () => {
    const merchant = (MERCHANT_ACTIONS.placed ?? []).map((action) => action.to);
    const admin = (ADMIN_ORDER_ACTIONS.placed ?? []).map((action) => action.to);

    merchant.forEach((target) => expect(admin).toContain(target));
    expect(admin.length).toBeGreaterThan(merchant.length);
  });

  it('lets only an admin cancel an unpaid order', () => {
    expect((ADMIN_ORDER_ACTIONS.pending_payment ?? []).map((action) => action.to)).toEqual([
      'cancelled',
    ]);
  });

  it('requires a reason for every destructive action', () => {
    const destructive = [
      ...Object.values(MERCHANT_ACTIONS).flat(),
      ...Object.values(ADMIN_ORDER_ACTIONS).flat(),
    ].filter((action) => action?.destructive);

    expect(destructive.length).toBeGreaterThan(0);
    destructive.forEach((action) => expect(action?.requiresReason).toBe(true));
  });

  it('counts every pre delivery status as merchant active work', () => {
    expect(MERCHANT_ACTIVE_STATUSES).not.toContain('delivered');
    expect(MERCHANT_ACTIVE_STATUSES).not.toContain('pending_payment');
    expect(MERCHANT_ACTIVE_STATUSES).toContain('placed');
  });
});

describe('status labels', () => {
  it('shows a human label rather than the raw enum', () => {
    expect(orderStatusLabel('ready_for_pickup')).toBe('Ready');
    expect(orderStatusLabel('pending_payment')).toBe('Awaiting payment');
  });

  it('falls back to a readable string for an unknown status', () => {
    expect(orderStatusLabel('some_new_status' as OrderStatus)).toBe('some new status');
  });
});

describe('status badge', () => {
  it('renders the customer facing label', () => {
    render(<OrderStatusBadge status="delivering" />);

    expect(screen.getByText('On the way')).toBeTruthy();
  });

  it('does not leak the raw status enum to the customer', () => {
    render(<OrderStatusBadge status="restaurant_rejected" />);

    expect(screen.queryByText('restaurant_rejected')).toBeNull();
    expect(screen.getByText('Rejected')).toBeTruthy();
  });

  it('renders a label for every status the database can produce', () => {
    const statuses: OrderStatus[] = [
      'pending_payment',
      'placed',
      'accepted',
      'preparing',
      'ready_for_pickup',
      'courier_assigned',
      'picked_up',
      'delivering',
      'delivered',
      'payment_failed',
      'restaurant_rejected',
      'cancelled',
      'refunded',
    ];

    statuses.forEach((status) => {
      const view = render(<OrderStatusBadge status={status} />);
      expect(screen.getByText(orderStatusLabel(status))).toBeTruthy();
      view.unmount();
    });
  });
});
