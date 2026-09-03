import { useProfile } from '@/hooks/useProfile';
import { useRealtimeTable } from '@/hooks/useRealtime';
import { adminService } from '@/services/adminService';
import { paymentService } from '@/services/paymentService';
import type {
  OrderStatus,
  PlatformSettingsPatch,
  RestaurantMemberRole,
  UserRole,
  VerificationStatus,
} from '@/types/database';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const ADMIN_KEY = ['admin'];

export const useIsAdmin = () => {
  const { profile, isLoading } = useProfile();
  return { isAdmin: profile?.role === 'admin', isLoading };
};

const useAdminMutation = <TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_KEY });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
};

export const useAdminOverview = (enabled: boolean) => {
  useRealtimeTable({
    channel: 'admin-overview',
    table: 'orders',
    enabled,
    invalidate: [['admin', 'overview'], ['admin', 'deliveries']],
  });

  return useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: adminService.getOverview,
    enabled,
    refetchInterval: 60000,
  });
};

export const useAdminRevenue = (enabled: boolean) =>
  useQuery({
    queryKey: ['admin', 'revenue'],
    queryFn: adminService.listDailyRevenue,
    enabled,
    staleTime: 1000 * 60 * 5,
  });

export const useAdminOrders = (statuses: OrderStatus[], search: string, enabled: boolean) => {
  useRealtimeTable({
    channel: 'admin-orders',
    table: 'orders',
    enabled,
    invalidate: [['admin', 'orders']],
  });

  return useQuery({
    queryKey: ['admin', 'orders', statuses.join(','), search],
    queryFn: () => adminService.listOrders(statuses, search),
    enabled,
  });
};

export const useAdminCouriers = (enabled: boolean) =>
  useQuery({
    queryKey: ['admin', 'couriers'],
    queryFn: adminService.listCouriers,
    enabled,
  });

export const useAdminCourierDocuments = (courierId: string | undefined) =>
  useQuery({
    queryKey: ['admin', 'courier-documents', courierId],
    queryFn: () => adminService.listCourierDocuments(courierId!),
    enabled: !!courierId,
  });

export const useAdminUsers = (search: string, enabled: boolean) =>
  useQuery({
    queryKey: ['admin', 'users', search],
    queryFn: () => adminService.listUsers(search),
    enabled,
  });

export const useUnassignedDeliveries = (enabled: boolean) => {
  useRealtimeTable({
    channel: 'admin-deliveries',
    table: 'deliveries',
    enabled,
    invalidate: [['admin', 'deliveries'], ['admin', 'overview']],
  });

  return useQuery({
    queryKey: ['admin', 'deliveries'],
    queryFn: adminService.listUnassignedDeliveries,
    enabled,
  });
};

export const useAdminActions = (enabled: boolean) =>
  useQuery({
    queryKey: ['admin', 'actions'],
    queryFn: () => adminService.listActions(),
    enabled,
  });

export const useAdminTransitionOrder = () =>
  useAdminMutation(
    ({ orderId, to, reason }: { orderId: string; to: OrderStatus; reason?: string | null }) =>
      adminService.transitionOrder(orderId, to, reason)
  );

export const useAdminRefund = () =>
  useAdminMutation(({ orderId, amount, reason }: { orderId: string; amount?: number; reason?: string }) =>
    paymentService.refundOrder(orderId, amount, reason)
  );

export const useSetUserRole = () =>
  useAdminMutation(({ userId, role }: { userId: string; role: UserRole }) =>
    adminService.setUserRole(userId, role)
  );

export const useReviewCourier = () =>
  useAdminMutation(
    ({
      courierId,
      status,
      notes,
    }: {
      courierId: string;
      status: VerificationStatus;
      notes?: string | null;
    }) => adminService.reviewCourier(courierId, status, notes)
  );

export const useReviewCourierDocument = () =>
  useAdminMutation(
    ({
      documentId,
      status,
      notes,
    }: {
      documentId: string;
      status: VerificationStatus;
      notes?: string | null;
    }) => adminService.reviewCourierDocument(documentId, status, notes)
  );

export const useSetRestaurantMember = () =>
  useAdminMutation(
    ({
      restaurantId,
      userId,
      role,
    }: {
      restaurantId: string;
      userId: string;
      role: RestaurantMemberRole;
    }) => adminService.setRestaurantMember(restaurantId, userId, role)
  );

export const useRemoveRestaurantMember = () =>
  useAdminMutation(({ restaurantId, userId }: { restaurantId: string; userId: string }) =>
    adminService.removeRestaurantMember(restaurantId, userId)
  );

export const useUpdatePlatformSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: PlatformSettingsPatch) => adminService.updateSettings(patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_KEY });
      queryClient.invalidateQueries({ queryKey: ['platform-settings'] });
    },
  });
};

export const useAssignDelivery = () =>
  useAdminMutation(({ deliveryId, courierId }: { deliveryId: string; courierId: string }) =>
    adminService.assignDelivery(deliveryId, courierId)
  );
