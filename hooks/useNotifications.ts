import useAuthStore from '@/hooks/use-auth-store';
import { useRealtimeTable } from '@/hooks/useRealtime';
import { notificationService } from '@/services/notificationService';
import type { PushPlatform } from '@/types/database';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

export const useNotifications = () => {
  const { user } = useAuthStore();
  const userId = user?.id;
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['notifications', userId],
    queryFn: () => notificationService.list(userId!),
    enabled: !!userId,
  });

  const unread = useQuery({
    queryKey: ['notifications-unread', userId],
    queryFn: () => notificationService.unreadCount(userId!),
    enabled: !!userId,
  });

  useRealtimeTable({
    channel: `notifications-${userId ?? 'anon'}`,
    table: 'notifications',
    event: 'INSERT',
    filter: userId ? `user_id=eq.${userId}` : undefined,
    enabled: !!userId,
    invalidate: [
      ['notifications', userId],
      ['notifications-unread', userId],
      ['orders', userId],
      ['active-delivery', userId],
    ],
  });

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => notificationService.markRead(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread', userId] });
    },
  });

  return {
    notifications: list.data ?? [],
    unreadCount: unread.data ?? 0,
    isLoading: list.isLoading,
    refetch: list.refetch,
    isRefetching: list.isRefetching,
    markRead: markRead.mutateAsync,
  };
};

export const usePushRegistration = () => {
  const { user } = useAuthStore();
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const register = async () => {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Order updates',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }

      const existing = await Notifications.getPermissionsAsync();
      let granted = existing.granted;

      if (!granted && existing.canAskAgain) {
        const requested = await Notifications.requestPermissionsAsync();
        granted = requested.granted;
      }

      if (!granted || cancelled) return;

      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
      if (!projectId) return;

      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      if (cancelled || !token?.data) return;

      await notificationService.registerPushToken(token.data, Platform.OS as PushPlatform);
    };

    register().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [userId]);
};
