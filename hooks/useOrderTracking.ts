import { ACTIVE_DELIVERY_STATUSES } from '@/constants/deliveryStatus';
import { TERMINAL_ORDER_STATUSES } from '@/constants/orderStatus';
import { useRealtimeTable } from '@/hooks/useRealtime';
import { courierService } from '@/services/courierService';
import { orderService } from '@/services/orderService';
import type { CourierLocation } from '@/types/database';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export const useOrderTracking = (orderId: string | undefined) => {
  const queryClient = useQueryClient();
  const [livePosition, setLivePosition] = useState<CourierLocation | null>(null);

  const order = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => orderService.getOrderById(orderId!),
    enabled: !!orderId,
  });

  const delivery = useQuery({
    queryKey: ['order-delivery', orderId],
    queryFn: () => courierService.getDeliveryForOrder(orderId!),
    enabled: !!orderId,
  });

  const history = useQuery({
    queryKey: ['order-history-trail', orderId],
    queryFn: () => orderService.getStatusHistory(orderId!),
    enabled: !!orderId,
  });

  const deliveryId = delivery.data?.id;
  const isLive =
    !!delivery.data && ACTIVE_DELIVERY_STATUSES.includes(delivery.data.status);

  const courier = useQuery({
    queryKey: ['tracked-courier', orderId],
    queryFn: () => courierService.getTrackedCourier(orderId!),
    enabled: !!orderId && isLive,
  });

  const lastKnown = useQuery({
    queryKey: ['courier-location', deliveryId],
    queryFn: () => courierService.listDeliveryLocations(deliveryId!),
    enabled: !!deliveryId && isLive,
  });

  useRealtimeTable({
    channel: `track-order-${orderId ?? 'none'}`,
    table: 'orders',
    filter: orderId ? `id=eq.${orderId}` : undefined,
    enabled: !!orderId,
    invalidate: [
      ['order', orderId],
      ['order-delivery', orderId],
      ['order-history-trail', orderId],
    ],
  });

  useRealtimeTable({
    channel: `track-delivery-${orderId ?? 'none'}`,
    table: 'deliveries',
    filter: orderId ? `order_id=eq.${orderId}` : undefined,
    enabled: !!orderId,
    invalidate: [
      ['order-delivery', orderId],
      ['tracked-courier', orderId],
    ],
  });

  useRealtimeTable({
    channel: `track-location-${deliveryId ?? 'none'}`,
    table: 'courier_locations',
    event: 'INSERT',
    filter: deliveryId ? `delivery_id=eq.${deliveryId}` : undefined,
    enabled: !!deliveryId && isLive,
    onChange: (payload) => {
      const row = payload.new as unknown as CourierLocation;
      if (row?.latitude != null) setLivePosition(row);
    },
  });

  useEffect(() => {
    if (!isLive) setLivePosition(null);
  }, [isLive]);

  useEffect(() => {
    const status = order.data?.status;
    if (status && TERMINAL_ORDER_STATUSES.includes(status)) {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    }
  }, [order.data?.status, queryClient]);

  const position =
    livePosition ??
    lastKnown.data?.[0] ??
    (courier.data?.current_latitude != null
      ? ({
          latitude: courier.data.current_latitude,
          longitude: courier.data.current_longitude ?? 0,
          recorded_at: courier.data.location_updated_at ?? new Date().toISOString(),
        } as CourierLocation)
      : null);

  return {
    order: order.data,
    delivery: delivery.data,
    history: history.data ?? [],
    courier: courier.data,
    courierPosition: position,
    isLive,
    isLoading: order.isLoading || delivery.isLoading,
    refetch: () => {
      order.refetch();
      delivery.refetch();
      history.refetch();
    },
  };
};
