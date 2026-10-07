import { supabase } from '@/lib/supabase';
import type { OrderChatAccess, OrderChatUnread, OrderMessage } from '@/types/database';

export const CHAT_PAGE_SIZE = 30;
export const MESSAGE_MAX_LENGTH = 1000;

export interface MessagePage {
  messages: OrderMessage[];
  nextCursor: { createdAt: string; id: string } | null;
}

export const chatService = {
  access: async (orderId: string): Promise<OrderChatAccess> => {
    const { data, error } = await supabase.rpc('order_chat_access', { p_order_id: orderId });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    return (row ?? {
      can_read: false,
      can_send: false,
      chat_role: null,
      courier_assigned: false,
      order_status: 'unknown',
      counterpart_name: null,
      reason: 'no_access',
    }) as OrderChatAccess;
  },

  page: async (
    orderId: string,
    cursor?: { createdAt: string; id: string } | null,
    limit = CHAT_PAGE_SIZE
  ): Promise<MessagePage> => {
    const { data, error } = await supabase.rpc('order_messages_page', {
      p_order_id: orderId,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
      p_limit: limit,
    });
    if (error) throw error;

    const messages = (data ?? []) as OrderMessage[];
    const last = messages[messages.length - 1];

    return {
      messages,
      nextCursor:
        messages.length < limit || !last ? null : { createdAt: last.created_at, id: last.id },
    };
  },

  send: async (
    orderId: string,
    clientMessageId: string,
    body: string
  ): Promise<OrderMessage> => {
    const { data, error } = await supabase.rpc('send_order_message', {
      p_order_id: orderId,
      p_client_message_id: clientMessageId,
      p_body: body,
    });
    if (error) throw error;
    return data as OrderMessage;
  },

  markRead: async (orderId: string): Promise<void> => {
    const { error } = await supabase.rpc('mark_order_messages_read', { p_order_id: orderId });
    if (error) throw error;
  },

  unreadCount: async (orderId: string): Promise<number> => {
    const { data, error } = await supabase.rpc('order_chat_unread_count', { p_order_id: orderId });
    if (error) throw error;
    return Number(data ?? 0);
  },

  unreadTotals: async (): Promise<OrderChatUnread[]> => {
    const { data, error } = await supabase.rpc('order_chat_unread_totals');
    if (error) throw error;
    return (data ?? []) as OrderChatUnread[];
  },
};
