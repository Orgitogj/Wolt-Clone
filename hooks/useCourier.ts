import useAuthStore from '@/hooks/use-auth-store';
import {
  DISPATCH_TICK_MS,
  LOCATION_UPDATE_DISTANCE_M,
  LOCATION_UPDATE_INTERVAL_MS,
} from '@/constants/deliveryStatus';
import { useRealtimeTable } from '@/hooks/useRealtime';
import {
  courierService,
  type CourierDocumentUpload,
  type RegisterCourierInput,
} from '@/services/courierService';
import type {
  CourierAvailability,
  CourierDocumentKind,
  DeliveryStatus,
} from '@/types/database';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useEffect, useRef } from 'react';

export const useCourierProfile = () => {
  const { user } = useAuthStore();
  const userId = user?.id;

  const query = useQuery({
    queryKey: ['courier', userId],
    queryFn: () => courierService.getProfile(userId!),
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  });

  return {
    courier: query.data,
    isLoading: query.isLoading,
    isCourier: !!query.data,
    isApproved: query.data?.verification_status === 'approved',
  };
};

export const useRegisterCourier = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: RegisterCourierInput) => courierService.register(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['courier', user?.id] }),
  });
};

export const useSetAvailability = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (availability: CourierAvailability) =>
      courierService.setAvailability(availability),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['courier', user?.id] }),
  });
};

export const useDeliveryOffers = (enabled: boolean) => {
  const { user } = useAuthStore();
  const userId = user?.id;

  useRealtimeTable({
    channel: `offers-${userId ?? 'anon'}`,
    table: 'delivery_offers',
    filter: userId ? `courier_id=eq.${userId}` : undefined,
    enabled: enabled && !!userId,
    invalidate: [['delivery-offers', userId]],
  });

  return useQuery({
    queryKey: ['delivery-offers', userId],
    queryFn: async () => {
      await courierService.advanceDispatch();
      return courierService.listOffers(userId!);
    },
    enabled: enabled && !!userId,
    refetchInterval: enabled ? DISPATCH_TICK_MS : false,
  });
};

export const useActiveDelivery = () => {
  const { user } = useAuthStore();
  const userId = user?.id;

  useRealtimeTable({
    channel: `active-delivery-${userId ?? 'anon'}`,
    table: 'deliveries',
    filter: userId ? `courier_id=eq.${userId}` : undefined,
    enabled: !!userId,
    invalidate: [['active-delivery', userId]],
  });

  return useQuery({
    queryKey: ['active-delivery', userId],
    queryFn: () => courierService.getActiveDelivery(userId!),
    enabled: !!userId,
  });
};

export const useRespondToOffer = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ offerId, accept }: { offerId: string; accept: boolean }) =>
      courierService.respondToOffer(offerId, accept),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-offers'] });
      queryClient.invalidateQueries({ queryKey: ['active-delivery'] });
      queryClient.invalidateQueries({ queryKey: ['courier'] });
    },
  });
};

export const useAdvanceDelivery = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ deliveryId, to }: { deliveryId: string; to: DeliveryStatus }) =>
      courierService.advanceDelivery(deliveryId, to),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-delivery'] });
      queryClient.invalidateQueries({ queryKey: ['courier'] });
      queryClient.invalidateQueries({ queryKey: ['courier-earnings'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
};

export const useCourierEarnings = () => {
  const { user } = useAuthStore();
  const userId = user?.id;

  const earnings = useQuery({
    queryKey: ['courier-earnings', userId],
    queryFn: () => courierService.listEarnings(userId!),
    enabled: !!userId,
  });

  const deliveries = useQuery({
    queryKey: ['courier-deliveries', userId],
    queryFn: () => courierService.listCompletedDeliveries(userId!),
    enabled: !!userId,
  });

  const rows = earnings.data ?? [];
  const total = rows.reduce((sum, row) => sum + Number(row.total), 0);
  const tips = rows.reduce((sum, row) => sum + Number(row.tip), 0);

  return {
    earnings: rows,
    deliveries: deliveries.data ?? [],
    total,
    tips,
    count: rows.length,
    isLoading: earnings.isLoading || deliveries.isLoading,
  };
};

export const useCourierLocationSync = (active: boolean) => {
  const subscription = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;

      subscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: LOCATION_UPDATE_DISTANCE_M,
          timeInterval: LOCATION_UPDATE_INTERVAL_MS,
        },
        (position) => {
          courierService
            .recordLocation({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              heading: position.coords.heading,
              speed: position.coords.speed,
            })
            .catch(() => undefined);
        }
      );
    };

    if (active) {
      start();
    }

    return () => {
      cancelled = true;
      subscription.current?.remove();
      subscription.current = null;
    };
  }, [active]);
};

export const useTrackedCourier = (orderId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['tracked-courier', orderId],
    queryFn: () => courierService.getTrackedCourier(orderId!),
    enabled: enabled && !!orderId,
    refetchInterval: enabled ? 10000 : false,
  });

export const useCourierDocuments = () => {
  const { user } = useAuthStore();
  const userId = user?.id;

  return useQuery({
    queryKey: ['courier-documents', userId],
    queryFn: () => courierService.listDocuments(userId!),
    enabled: !!userId,
  });
};

export const useSubmitCourierDocument = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const userId = user?.id;

  return useMutation({
    mutationFn: ({ kind, file }: { kind: CourierDocumentKind; file: CourierDocumentUpload }) =>
      courierService.submitDocument(userId!, kind, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['courier-documents', userId] });
      queryClient.invalidateQueries({ queryKey: ['courier', userId] });
    },
  });
};
