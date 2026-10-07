import { ACTIVE_DELIVERY_STATUSES } from '@/constants/deliveryStatus';
import { TERMINAL_ORDER_STATUSES } from '@/constants/orderStatus';
import useAuthStore from '@/hooks/use-auth-store';
import {
  useAppForeground,
  usePollingFallback,
  useRealtimeTable,
} from '@/hooks/useRealtime';
import { courierService } from '@/services/courierService';
import { orderService } from '@/services/orderService';
import type { CourierLocation } from '@/types/database';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

const STALE_AFTER_MS = 90000;

export const useOrderTracking = (orderId: string | undefined) => {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [livePosition, setLivePosition] = useState<CourierLocation | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number>(() => Date.now());

  const scoped = !!orderId && !!userId;

  const order = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => orderService.getOrderById(orderId!),
    enabled: scoped,
  });

  const delivery = useQuery({
    queryKey: ['order-delivery', orderId],
    queryFn: () => courierService.getDeliveryForOrder(orderId!),
    enabled: scoped,
  });

  const history = useQuery({
    queryKey: ['order-history-trail', orderId],
    queryFn: () => orderService.getStatusHistory(orderId!),
    enabled: scoped,
  });

  const status = order.data?.status;
  const isTerminal = !!status && TERMINAL_ORDER_STATUSES.includes(status);
  const deliveryId = delivery.data?.id;
  const isLive = !!delivery.data && ACTIVE_DELIVERY_STATUSES.includes(delivery.data.status);
  const subscriptionsEnabled = scoped && !isTerminal;

  const courier = useQuery({
    queryKey: ['tracked-courier', orderId],
    queryFn: () => courierService.getTrackedCourier(orderId!),
    enabled: scoped && isLive,
  });

  const lastKnown = useQuery({
    queryKey: ['courier-location', deliveryId],
    queryFn: () => courierService.listDeliveryLocations(deliveryId!),
    enabled: !!deliveryId && isLive,
  });

  const markEvent = useCallback(() => setLastEventAt(Date.now()), []);

  const orderChannel = useRealtimeTable({
    channel: `track-order-${orderId ?? 'none'}`,
    table: 'orders',
    filter: orderId ? `id=eq.${orderId}` : undefined,
    enabled: subscriptionsEnabled,
    invalidate: [
      ['order', orderId],
      ['order-delivery', orderId],
      ['order-history-trail', orderId],
    ],
    onChange: markEvent,
  });

  useRealtimeTable({
    channel: `track-delivery-${orderId ?? 'none'}`,
    table: 'deliveries',
    filter: orderId ? `order_id=eq.${orderId}` : undefined,
    enabled: subscriptionsEnabled,
    invalidate: [
      ['order-delivery', orderId],
      ['tracked-courier', orderId],
    ],
    onChange: markEvent,
  });

  useRealtimeTable({
    channel: `track-location-${deliveryId ?? 'none'}`,
    table: 'courier_locations',
    event: 'INSERT',
    filter: deliveryId ? `delivery_id=eq.${deliveryId}` : undefined,
    enabled: !!deliveryId && isLive && !isTerminal,
    onChange: (payload) => {
      const row = payload.new as unknown as CourierLocation;
      if (row?.latitude == null) return;

      markEvent();
      setLivePosition((current) => {
        if (!current) return row;
        if (!row.recorded_at) return current;
        return new Date(row.recorded_at) >= new Date(current.recorded_at) ? row : current;
      });
    },
  });

  const refetch = useCallback(() => {
    void order.refetch();
    void delivery.refetch();
    void history.refetch();
    if (isLive) {
      void courier.refetch();
      void lastKnown.refetch();
    }
    markEvent();
  }, [order, delivery, history, courier, lastKnown, isLive, markEvent]);

  useAppForeground(refetch, scoped && !isTerminal);

  const realtimeDown = orderChannel === 'disconnected';

  const polling = usePollingFallback(refetch, {
    enabled: subscriptionsEnabled && realtimeDown,
  });

  useEffect(() => {
    if (!isLive) setLivePosition(null);
  }, [isLive]);

  useEffect(() => {
    if (isTerminal) setLivePosition(null);
  }, [isTerminal]);

  useEffect(() => {
    if (isTerminal) {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    }
  }, [isTerminal, queryClient]);

  const position = isLive
    ? (livePosition ??
      lastKnown.data?.[0] ??
      (courier.data?.current_latitude != null
        ? ({
            latitude: courier.data.current_latitude,
            longitude: courier.data.current_longitude ?? 0,
            recorded_at: courier.data.location_updated_at ?? new Date().toISOString(),
          } as CourierLocation)
        : null))
    : null;

  const isStale =
    subscriptionsEnabled && realtimeDown && Date.now() - lastEventAt > STALE_AFTER_MS;

  return {
    order: order.data,
    delivery: delivery.data,
    history: history.data ?? [],
    courier: isLive ? courier.data : undefined,
    courierPosition: position,
    isLive,
    isTerminal,
    isLoading: order.isLoading || delivery.isLoading,
    error: order.error ?? delivery.error ?? null,
    isRefetching: order.isRefetching,
    connection: orderChannel,
    isStale,
    isPollingExhausted: polling.isExhausted,
    refetch,
  };
};
