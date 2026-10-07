import useAuthStore from '@/hooks/use-auth-store';
import { useAppForeground, useRealtimeTable } from '@/hooks/useRealtime';
import { CHAT_PAGE_SIZE, chatService } from '@/services/chatService';
import type { OrderMessage, OutgoingMessage } from '@/types/database';
import { currentSessionEpoch, isStaleSession } from '@/utils/sessionGuard';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const useOrderChatAccess = (orderId: string | undefined) => {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  return useQuery({
    queryKey: ['order-chat-access', orderId, userId],
    queryFn: () => chatService.access(orderId!),
    enabled: !!orderId && !!userId,
  });
};

export const useOrderChatUnreadTotals = () => {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  return useQuery({
    queryKey: ['order-chat-unread', userId],
    queryFn: () => chatService.unreadTotals(),
    enabled: !!userId,
  });
};

export const useOrderChat = (orderId: string | undefined) => {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [outgoing, setOutgoing] = useState<OutgoingMessage[]>([]);

  const access = useOrderChatAccess(orderId);
  const canRead = !!access.data?.can_read;
  const canSend = !!access.data?.can_send;
  const scoped = !!orderId && !!userId && canRead;

  const history = useInfiniteQuery({
    queryKey: ['order-chat', orderId, userId],
    queryFn: ({ pageParam }) => chatService.page(orderId!, pageParam),
    initialPageParam: null as { createdAt: string; id: string } | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: scoped,
  });

  const serverMessages = useMemo(
    () => (history.data?.pages ?? []).flatMap((page) => page.messages),
    [history.data]
  );

  const deliveredClientIds = useMemo(
    () => new Set(serverMessages.map((message) => message.client_message_id)),
    [serverMessages]
  );

  useEffect(() => {
    if (deliveredClientIds.size === 0) return;
    setOutgoing((current) =>
      current.filter((message) => !deliveredClientIds.has(message.client_message_id))
    );
  }, [deliveredClientIds]);

  useEffect(() => {
    if (canRead) return;
    setOutgoing([]);
    if (orderId) {
      queryClient.removeQueries({ queryKey: ['order-chat', orderId] });
    }
  }, [canRead, orderId, queryClient]);

  useEffect(() => {
    setOutgoing([]);
  }, [userId, orderId]);

  const refresh = useCallback(() => {
    if (!scoped) return;
    void queryClient.invalidateQueries({ queryKey: ['order-chat', orderId, userId] });
    void access.refetch();
  }, [scoped, queryClient, orderId, userId, access]);

  const connection = useRealtimeTable({
    channel: `order-chat-${orderId ?? 'none'}`,
    table: 'order_messages',
    event: 'INSERT',
    filter: orderId ? `order_id=eq.${orderId}` : undefined,
    enabled: scoped,
    invalidate: [['order-chat', orderId, userId]],
  });

  useRealtimeTable({
    channel: `order-chat-status-${orderId ?? 'none'}`,
    table: 'orders',
    event: 'UPDATE',
    filter: orderId ? `id=eq.${orderId}` : undefined,
    enabled: scoped,
    invalidate: [['order-chat-access', orderId, userId]],
  });

  useRealtimeTable({
    channel: `order-chat-assignment-${orderId ?? 'none'}`,
    table: 'deliveries',
    event: 'UPDATE',
    filter: orderId ? `order_id=eq.${orderId}` : undefined,
    enabled: scoped,
    invalidate: [['order-chat-access', orderId, userId]],
  });

  useAppForeground(refresh, scoped);

  const markRead = useCallback(async () => {
    if (!scoped || !orderId) return;
    const epoch = currentSessionEpoch();
    try {
      await chatService.markRead(orderId);
      if (isStaleSession(epoch)) return;
      void queryClient.invalidateQueries({ queryKey: ['order-chat-unread', userId] });
    } catch {
      return;
    }
  }, [scoped, orderId, queryClient, userId]);

  const deliver = useCallback(
    async (clientMessageId: string, body: string) => {
      if (!orderId) return;
      const epoch = currentSessionEpoch();

      try {
        await chatService.send(orderId, clientMessageId, body);
        if (isStaleSession(epoch)) return;

        setOutgoing((current) =>
          current.filter((message) => message.client_message_id !== clientMessageId)
        );
        void queryClient.invalidateQueries({ queryKey: ['order-chat', orderId, userId] });
      } catch {
        if (isStaleSession(epoch)) return;
        setOutgoing((current) =>
          current.map((message) =>
            message.client_message_id === clientMessageId
              ? { ...message, state: 'failed' }
              : message
          )
        );
      }
    },
    [orderId, queryClient, userId]
  );

  const send = useCallback(
    (body: string) => {
      const trimmed = body.trim();
      if (!trimmed || !canSend) return;

      const clientMessageId = Crypto.randomUUID();
      setOutgoing((current) => [
        ...current,
        {
          client_message_id: clientMessageId,
          body: trimmed,
          state: 'pending',
          created_at: new Date().toISOString(),
        },
      ]);

      void deliver(clientMessageId, trimmed);
    },
    [canSend, deliver]
  );

  const retry = useCallback(
    (clientMessageId: string) => {
      const message = outgoing.find((item) => item.client_message_id === clientMessageId);
      if (!message) return;

      setOutgoing((current) =>
        current.map((item) =>
          item.client_message_id === clientMessageId ? { ...item, state: 'pending' } : item
        )
      );

      void deliver(clientMessageId, message.body);
    },
    [outgoing, deliver]
  );

  const discard = useCallback((clientMessageId: string) => {
    setOutgoing((current) =>
      current.filter((message) => message.client_message_id !== clientMessageId)
    );
  }, []);

  const loadOlder = useCallback(() => {
    if (history.hasNextPage && !history.isFetchingNextPage && !history.isFetchNextPageError) {
      void history.fetchNextPage();
    }
  }, [history]);

  return {
    access: access.data,
    accessError: access.error,
    isAccessLoading: access.isLoading,
    refetchAccess: access.refetch,
    messages: serverMessages,
    outgoing,
    canRead,
    canSend,
    isLoading: history.isLoading,
    error: history.error,
    refetch: history.refetch,
    loadOlder,
    hasOlder: !!history.hasNextPage,
    isLoadingOlder: history.isFetchingNextPage,
    isOlderError: history.isFetchNextPageError,
    connection,
    send,
    retry,
    discard,
    markRead,
    refresh,
    pageSize: CHAT_PAGE_SIZE,
  };
};

export const mergeChatTimeline = (
  serverMessages: OrderMessage[],
  outgoing: OutgoingMessage[]
): (OrderMessage | OutgoingMessage)[] => {
  const delivered = new Set(serverMessages.map((message) => message.client_message_id));
  const pending = outgoing.filter((message) => !delivered.has(message.client_message_id));

  const timeline: (OrderMessage | OutgoingMessage)[] = [...pending].reverse();
  return timeline.concat(serverMessages);
};

export const useChatScrollAnchor = () => {
  const isReadingHistory = useRef(false);

  const onScroll = useCallback((distanceFromBottom: number) => {
    isReadingHistory.current = distanceFromBottom > 120;
  }, []);

  return { isReadingHistory, onScroll };
};
