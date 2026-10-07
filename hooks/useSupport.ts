import useAuthStore from '@/hooks/use-auth-store';
import { useAppForeground, useRealtimeTable } from '@/hooks/useRealtime';
import {
  SUPPORT_MESSAGE_PAGE_SIZE,
  SUPPORT_PAGE_SIZE,
  supportService,
  type AdminSupportFilters,
} from '@/services/supportService';
import type {
  OutgoingMessage,
  SupportCategory,
  SupportMessage,
  SupportReportDraftItem,
  SupportTicketStatus,
} from '@/types/database';
import { currentSessionEpoch, isStaleSession } from '@/utils/sessionGuard';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useState } from 'react';

export const useSupportEligibility = (orderId: string | undefined) => {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  return useQuery({
    queryKey: ['support-eligibility', orderId, userId],
    queryFn: () => supportService.eligibility(orderId!),
    enabled: !!orderId && !!userId,
  });
};

export const useMySupportTickets = () => {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  const query = useInfiniteQuery({
    queryKey: ['support-tickets', userId],
    queryFn: ({ pageParam }) => supportService.myTickets(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled: !!userId,
  });

  const tickets = useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.tickets),
    [query.data]
  );

  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) {
      void query.fetchNextPage();
    }
  }, [query]);

  return { ...query, tickets, loadMore, pageSize: SUPPORT_PAGE_SIZE };
};

export const useSubmitSupportTicket = (orderId: string | undefined) => {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id ?? null);

  return useMutation({
    mutationFn: (input: {
      category: SupportCategory;
      description: string;
      items: SupportReportDraftItem[];
      clientTicketId: string;
    }) =>
      supportService.submit(
        orderId!,
        input.clientTicketId,
        input.category,
        input.description,
        input.items
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['support-tickets', userId] });
      void queryClient.invalidateQueries({ queryKey: ['support-eligibility', orderId, userId] });
    },
  });
};

export const useSupportTicket = (ticketId: string | undefined) => {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  return useQuery({
    queryKey: ['support-ticket', ticketId, userId],
    queryFn: () => supportService.details(ticketId!),
    enabled: !!ticketId && !!userId,
    retry: false,
  });
};

export const useSupportReportedItems = (ticketId: string | undefined, enabled = true) => {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  return useQuery({
    queryKey: ['support-ticket-items', ticketId, userId],
    queryFn: () => supportService.reportedItems(ticketId!),
    enabled: !!ticketId && !!userId && enabled,
  });
};

export const useSupportRefunds = (ticketId: string | undefined) => {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  return useQuery({
    queryKey: ['support-refunds', ticketId, userId],
    queryFn: () => supportService.refunds(ticketId!),
    enabled: !!ticketId && !!userId,
  });
};

export const useOrderRefundSummary = (orderId: string | undefined) => {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  return useQuery({
    queryKey: ['order-refund-summary', orderId, userId],
    queryFn: () => supportService.refundSummary(orderId!),
    enabled: !!orderId && !!userId,
  });
};

export const useSupportConversation = (ticketId: string | undefined) => {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [outgoing, setOutgoing] = useState<OutgoingMessage[]>([]);

  const ticket = useSupportTicket(ticketId);
  const canRead = !!ticket.data;
  const scoped = !!ticketId && !!userId && canRead;

  const history = useInfiniteQuery({
    queryKey: ['support-messages', ticketId, userId],
    queryFn: ({ pageParam }) => supportService.messages(ticketId!, pageParam),
    initialPageParam: null as { createdAt: string; id: string } | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: scoped,
  });

  const messages = useMemo(
    () => (history.data?.pages ?? []).flatMap((page) => page.messages),
    [history.data]
  );

  const deliveredClientIds = useMemo(
    () => new Set(messages.map((message) => message.client_message_id)),
    [messages]
  );

  useEffect(() => {
    if (deliveredClientIds.size === 0) return;
    setOutgoing((current) =>
      current.filter((message) => !deliveredClientIds.has(message.client_message_id))
    );
  }, [deliveredClientIds]);

  useEffect(() => {
    setOutgoing([]);
  }, [userId, ticketId]);

  useEffect(() => {
    if (canRead || !ticketId) return;
    setOutgoing([]);
    queryClient.removeQueries({ queryKey: ['support-messages', ticketId] });
  }, [canRead, ticketId, queryClient]);

  const refresh = useCallback(() => {
    if (!scoped) return;
    void queryClient.invalidateQueries({ queryKey: ['support-messages', ticketId, userId] });
    void ticket.refetch();
  }, [scoped, queryClient, ticketId, userId, ticket]);

  const connection = useRealtimeTable({
    channel: `support-ticket-messages-${ticketId ?? 'none'}`,
    table: 'support_messages',
    event: 'INSERT',
    filter: ticketId ? `ticket_id=eq.${ticketId}` : undefined,
    enabled: scoped,
    invalidate: [['support-messages', ticketId, userId]],
  });

  useRealtimeTable({
    channel: `support-ticket-state-${ticketId ?? 'none'}`,
    table: 'support_tickets',
    event: 'UPDATE',
    filter: ticketId ? `id=eq.${ticketId}` : undefined,
    enabled: scoped,
    invalidate: [
      ['support-ticket', ticketId, userId],
      ['support-refunds', ticketId, userId],
    ],
  });

  useAppForeground(refresh, scoped);

  const markRead = useCallback(async () => {
    if (!scoped || !ticketId) return;
    const epoch = currentSessionEpoch();

    try {
      await supportService.markRead(ticketId);
      if (isStaleSession(epoch)) return;
      void queryClient.invalidateQueries({ queryKey: ['support-tickets', userId] });
    } catch {
      return;
    }
  }, [scoped, ticketId, queryClient, userId]);

  const deliver = useCallback(
    async (clientMessageId: string, body: string) => {
      if (!ticketId) return;
      const epoch = currentSessionEpoch();

      try {
        await supportService.sendMessage(ticketId, clientMessageId, body);
        if (isStaleSession(epoch)) return;

        setOutgoing((current) =>
          current.filter((message) => message.client_message_id !== clientMessageId)
        );
        void queryClient.invalidateQueries({ queryKey: ['support-messages', ticketId, userId] });
        void queryClient.invalidateQueries({ queryKey: ['support-ticket', ticketId, userId] });
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
    [ticketId, queryClient, userId]
  );

  const send = useCallback(
    (body: string) => {
      const trimmed = body.trim();
      if (!trimmed || !scoped) return;

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
    [scoped, deliver]
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
    ticket: ticket.data,
    ticketError: ticket.error,
    isTicketLoading: ticket.isLoading,
    messages,
    outgoing,
    canRead,
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
    pageSize: SUPPORT_MESSAGE_PAGE_SIZE,
  };
};

export const useAdminSupportTickets = (filters: AdminSupportFilters) => {
  const query = useInfiniteQuery({
    queryKey: ['admin-support', filters.status, filters.category, filters.assignment],
    queryFn: ({ pageParam }) => supportService.adminTickets(filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
  });

  const tickets = useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.tickets),
    [query.data]
  );

  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) {
      void query.fetchNextPage();
    }
  }, [query]);

  return { ...query, tickets, loadMore, pageSize: SUPPORT_PAGE_SIZE };
};

const useSupportTicketInvalidation = (ticketId: string | undefined) => {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id ?? null);

  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['admin-support'] });
    void queryClient.invalidateQueries({ queryKey: ['support-ticket', ticketId, userId] });
    void queryClient.invalidateQueries({ queryKey: ['support-refunds', ticketId, userId] });
    void queryClient.invalidateQueries({ queryKey: ['support-messages', ticketId, userId] });
    void queryClient.invalidateQueries({ queryKey: ['order-refund-summary'] });
  }, [queryClient, ticketId, userId]);
};

export const useAssignSupportTicket = (ticketId: string | undefined) => {
  const invalidate = useSupportTicketInvalidation(ticketId);

  return useMutation({
    mutationFn: (input: { adminId: string | null; revision: number }) =>
      supportService.assign(ticketId!, input.adminId, input.revision),
    onSuccess: invalidate,
  });
};

export const useSetSupportStatus = (ticketId: string | undefined) => {
  const invalidate = useSupportTicketInvalidation(ticketId);

  return useMutation({
    mutationFn: (input: { status: SupportTicketStatus; revision: number; note?: string }) =>
      supportService.setStatus(ticketId!, input.status, input.revision, input.note),
    onSuccess: invalidate,
  });
};

export const useApproveSupportRefund = (ticketId: string | undefined) => {
  const invalidate = useSupportTicketInvalidation(ticketId);

  return useMutation({
    mutationFn: (input: {
      amount: number;
      reason: string;
      liability: 'platform' | 'restaurant';
      clientRequestId: string;
    }) =>
      supportService.approveRefund(
        ticketId!,
        input.amount,
        input.reason,
        input.liability,
        input.clientRequestId
      ),
    onSuccess: invalidate,
  });
};

export const useConfirmCashRefund = (ticketId: string | undefined) => {
  const invalidate = useSupportTicketInvalidation(ticketId);

  return useMutation({
    mutationFn: (input: { refundId: string; reason: string }) =>
      supportService.confirmCashRefund(input.refundId, input.reason),
    onSuccess: invalidate,
  });
};

export const mergeSupportTimeline = (
  messages: SupportMessage[],
  outgoing: OutgoingMessage[]
): (SupportMessage | OutgoingMessage)[] => {
  const delivered = new Set(messages.map((message) => message.client_message_id));
  const pending = outgoing.filter((message) => !delivered.has(message.client_message_id));

  const timeline: (SupportMessage | OutgoingMessage)[] = [...pending].reverse();
  return timeline.concat(messages);
};
