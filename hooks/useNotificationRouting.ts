import useAuthStore from '@/hooks/use-auth-store';
import { useIsSessionRestored } from '@/hooks/use-session-store';
import { chatService } from '@/services/chatService';
import { supportService } from '@/services/supportService';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';

export const SUPPORT_TICKET_ROUTE = '/order/support-ticket';
export const CHAT_ROUTE = '/order/chat';

export interface PendingDestination {
  route: string;
  orderId: string;
  ticketId?: string;
}

let pendingDestination: PendingDestination | null = null;

export const setPendingDestination = (destination: PendingDestination | null) => {
  pendingDestination = destination;
};

export const takePendingDestination = (): PendingDestination | null => {
  const destination = pendingDestination;
  pendingDestination = null;
  return destination;
};

export const peekPendingDestination = (): PendingDestination | null => pendingDestination;

export const destinationFromNotificationData = (
  data: Record<string, unknown> | undefined | null
): PendingDestination | null => {
  if (!data) return null;

  const route = typeof data.route === 'string' ? data.route : null;
  const orderId = typeof data.order_id === 'string' ? data.order_id : null;
  const ticketId = typeof data.ticket_id === 'string' ? data.ticket_id : null;

  if (!route || !orderId) return null;

  if (route === SUPPORT_TICKET_ROUTE) {
    if (!ticketId) return null;
    return { route, orderId, ticketId };
  }

  if (route !== CHAT_ROUTE) return null;

  return { route, orderId };
};

export const canOpenDestination = async (
  destination: PendingDestination
): Promise<boolean> => {
  try {
    if (destination.route === SUPPORT_TICKET_ROUTE) {
      if (!destination.ticketId) return false;
      await supportService.details(destination.ticketId);
      return true;
    }

    const access = await chatService.access(destination.orderId);
    return access.can_read;
  } catch {
    return false;
  }
};

export const useNotificationRouting = () => {
  const router = useRouter();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const isRestored = useIsSessionRestored();
  const [isResolving, setIsResolving] = useState(false);
  const inFlight = useRef(false);

  const openIfAllowed = useCallback(
    async (destination: PendingDestination) => {
      const allowed = await canOpenDestination(destination);
      if (!allowed) return false;

      if (destination.route === SUPPORT_TICKET_ROUTE && destination.ticketId) {
        router.push({ pathname: SUPPORT_TICKET_ROUTE, params: { id: destination.ticketId } });
        return true;
      }

      router.push({ pathname: CHAT_ROUTE, params: { id: destination.orderId } });
      return true;
    },
    [router]
  );

  const handleNotification = useCallback(
    async (data: Record<string, unknown> | undefined | null) => {
      const destination = destinationFromNotificationData(data);
      if (!destination) return;

      if (!userId || !isRestored) {
        setPendingDestination(destination);
        return;
      }

      const opened = await openIfAllowed(destination);
      if (!opened) setPendingDestination(null);
    },
    [userId, isRestored, openIfAllowed]
  );

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleNotification(
        response.notification.request.content.data as Record<string, unknown> | undefined
      );
    });

    return () => subscription.remove();
  }, [handleNotification]);

  useEffect(() => {
    if (!userId || !isRestored || inFlight.current) return;

    const destination = takePendingDestination();
    if (!destination) return;

    inFlight.current = true;
    setIsResolving(true);

    void openIfAllowed(destination)
      .catch(() => false)
      .finally(() => {
        inFlight.current = false;
        setIsResolving(false);
      });
  }, [userId, isRestored, openIfAllowed]);

  return { isResolving, handleNotification };
};
