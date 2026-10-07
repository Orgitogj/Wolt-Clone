import { supabase } from '@/lib/supabase';
import type {
  AdminSupportTicket,
  OrderRefundSummary,
  SupportAssignmentFilter,
  SupportCategory,
  SupportMessage,
  SupportRefund,
  SupportReportDraftItem,
  SupportReportEligibility,
  SupportReportedItem,
  SupportTicketDetails,
  SupportTicketStatus,
  SupportTicketSummary,
} from '@/types/database';

export const SUPPORT_PAGE_SIZE = 20;
export const SUPPORT_MESSAGE_PAGE_SIZE = 30;
export const SUPPORT_DESCRIPTION_MAX_LENGTH = 2000;
export const SUPPORT_MESSAGE_MAX_LENGTH = 2000;

export const SUPPORT_CATEGORIES: { value: SupportCategory; label: string; hint: string }[] = [
  {
    value: 'missing_items',
    label: 'Something was missing',
    hint: 'Pick the items that never arrived',
  },
  {
    value: 'incorrect_items',
    label: 'I got the wrong items',
    hint: 'Pick the items that were wrong',
  },
  { value: 'late_delivery', label: 'It arrived very late', hint: 'Tell us how late it was' },
  { value: 'not_delivered', label: 'It never arrived', hint: 'Tell us what happened' },
  { value: 'other', label: 'Something else', hint: 'Describe the problem' },
];

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  missing_items: 'Missing items',
  incorrect_items: 'Wrong items',
  late_delivery: 'Late delivery',
  not_delivered: 'Never arrived',
  other: 'Other',
};

export const SUPPORT_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: 'Open',
  in_review: 'Being reviewed',
  resolved: 'Resolved',
};

export const SUPPORT_REPORT_BLOCKERS: Record<string, string> = {
  unknown_order: 'We cannot find that order.',
  not_your_order: 'That order belongs to another account.',
  not_delivered_yet: 'You can report a problem once the order is finished.',
  too_old: 'This order is too old to report.',
  already_open: 'You already have an open report for this order.',
  too_many_tickets: 'You have reported this order too many times.',
};

export const ITEM_CATEGORIES: SupportCategory[] = ['missing_items', 'incorrect_items'];

export interface SupportTicketPage {
  tickets: SupportTicketSummary[];
  nextOffset: number | null;
}

export interface AdminSupportTicketPage {
  tickets: AdminSupportTicket[];
  nextOffset: number | null;
}

export interface SupportMessagePage {
  messages: SupportMessage[];
  nextCursor: { createdAt: string; id: string } | null;
}

export interface AdminSupportFilters {
  status: SupportTicketStatus | null;
  category: SupportCategory | null;
  assignment: SupportAssignmentFilter;
}

const firstRow = <T,>(data: unknown): T | null => {
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return (data as T) ?? null;
};

export const supportService = {
  eligibility: async (orderId: string): Promise<SupportReportEligibility> => {
    const { data, error } = await supabase.rpc('support_report_eligibility', {
      p_order_id: orderId,
    });
    if (error) throw error;

    return (
      firstRow<SupportReportEligibility>(data) ?? {
        can_report: false,
        reason: 'unknown_order',
        open_ticket_id: null,
        closes_at: null,
      }
    );
  },

  submit: async (
    orderId: string,
    clientTicketId: string,
    category: SupportCategory,
    description: string,
    items: SupportReportDraftItem[] = []
  ): Promise<{ id: string }> => {
    const { data, error } = await supabase.rpc('submit_support_ticket', {
      p_order_id: orderId,
      p_client_ticket_id: clientTicketId,
      p_category: category,
      p_description: description,
      p_items: items,
    });
    if (error) throw error;
    return data as { id: string };
  },

  myTickets: async (offset = 0, limit = SUPPORT_PAGE_SIZE): Promise<SupportTicketPage> => {
    const { data, error } = await supabase.rpc('my_support_tickets', {
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw error;

    const tickets = (data ?? []) as SupportTicketSummary[];
    return {
      tickets,
      nextOffset: tickets.length < limit ? null : offset + tickets.length,
    };
  },

  details: async (ticketId: string): Promise<SupportTicketDetails> => {
    const { data, error } = await supabase.rpc('support_ticket_details', {
      p_ticket_id: ticketId,
    });
    if (error) throw error;

    const row = firstRow<SupportTicketDetails>(data);
    if (!row) throw new Error('That report is not available.');
    return row;
  },

  reportedItems: async (ticketId: string): Promise<SupportReportedItem[]> => {
    const { data, error } = await supabase.rpc('support_ticket_reported_items', {
      p_ticket_id: ticketId,
    });
    if (error) throw error;
    return (data ?? []) as SupportReportedItem[];
  },

  messages: async (
    ticketId: string,
    cursor?: { createdAt: string; id: string } | null,
    limit = SUPPORT_MESSAGE_PAGE_SIZE
  ): Promise<SupportMessagePage> => {
    const { data, error } = await supabase.rpc('support_messages_page', {
      p_ticket_id: ticketId,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
      p_limit: limit,
    });
    if (error) throw error;

    const messages = (data ?? []) as SupportMessage[];
    const last = messages[messages.length - 1];

    return {
      messages,
      nextCursor:
        messages.length < limit || !last ? null : { createdAt: last.created_at, id: last.id },
    };
  },

  sendMessage: async (
    ticketId: string,
    clientMessageId: string,
    body: string
  ): Promise<SupportMessage> => {
    const { data, error } = await supabase.rpc('send_support_message', {
      p_ticket_id: ticketId,
      p_client_message_id: clientMessageId,
      p_body: body,
    });
    if (error) throw error;
    return data as SupportMessage;
  },

  markRead: async (ticketId: string): Promise<void> => {
    const { error } = await supabase.rpc('mark_support_messages_read', {
      p_ticket_id: ticketId,
    });
    if (error) throw error;
  },

  unreadCount: async (ticketId: string): Promise<number> => {
    const { data, error } = await supabase.rpc('support_unread_count', {
      p_ticket_id: ticketId,
    });
    if (error) throw error;
    return Number(data ?? 0);
  },

  refunds: async (ticketId: string): Promise<SupportRefund[]> => {
    const { data, error } = await supabase.rpc('support_refunds_for_ticket', {
      p_ticket_id: ticketId,
    });
    if (error) throw error;
    return (data ?? []) as SupportRefund[];
  },

  refundSummary: async (orderId: string): Promise<OrderRefundSummary | null> => {
    const { data, error } = await supabase.rpc('order_refund_summary', { p_order_id: orderId });
    if (error) throw error;
    return firstRow<OrderRefundSummary>(data);
  },

  adminTickets: async (
    filters: AdminSupportFilters,
    offset = 0,
    limit = SUPPORT_PAGE_SIZE
  ): Promise<AdminSupportTicketPage> => {
    const { data, error } = await supabase.rpc('admin_support_tickets', {
      p_status: filters.status,
      p_category: filters.category,
      p_assignment: filters.assignment === 'all' ? null : filters.assignment,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw error;

    const tickets = (data ?? []) as AdminSupportTicket[];
    return {
      tickets,
      nextOffset: tickets.length < limit ? null : offset + tickets.length,
    };
  },

  assign: async (
    ticketId: string,
    adminId: string | null,
    revision: number
  ): Promise<SupportTicketDetails> => {
    const { data, error } = await supabase.rpc('admin_assign_support_ticket', {
      p_ticket_id: ticketId,
      p_admin_id: adminId,
      p_expected_revision: revision,
    });
    if (error) throw error;
    return data as SupportTicketDetails;
  },

  setStatus: async (
    ticketId: string,
    status: SupportTicketStatus,
    revision: number,
    note?: string
  ): Promise<SupportTicketDetails> => {
    const { data, error } = await supabase.rpc('admin_set_support_status', {
      p_ticket_id: ticketId,
      p_status: status,
      p_expected_revision: revision,
      p_note: note ?? null,
    });
    if (error) throw error;
    return data as SupportTicketDetails;
  },

  approveRefund: async (
    ticketId: string,
    amount: number,
    reason: string,
    liability: 'platform' | 'restaurant',
    clientRequestId: string
  ): Promise<SupportRefund> => {
    const { data, error } = await supabase.rpc('admin_approve_support_refund', {
      p_ticket_id: ticketId,
      p_amount: amount,
      p_reason: reason,
      p_liability: liability,
      p_client_request_id: clientRequestId,
    });
    if (error) throw error;
    return data as SupportRefund;
  },

  confirmCashRefund: async (refundId: string, reason: string): Promise<SupportRefund> => {
    const { data, error } = await supabase.rpc('admin_confirm_cash_refund', {
      p_refund_id: refundId,
      p_reason: reason,
    });
    if (error) throw error;
    return data as SupportRefund;
  },
};

export const needsReportedItems = (category: SupportCategory): boolean =>
  ITEM_CATEGORIES.includes(category);

export const describeReportBlocker = (reason: string): string =>
  SUPPORT_REPORT_BLOCKERS[reason] ?? 'You cannot report a problem on this order.';

export const parseRefundAmount = (input: string): number | null => {
  const normalised = input.replace(',', '.').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) return null;

  const amount = Number(normalised);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100) / 100;
};

export const isRefundWithinBalance = (amount: number, remaining: number): boolean =>
  Math.round(amount * 100) <= Math.round(remaining * 100);

export const openRefundTotal = (refunds: SupportRefund[]): number =>
  refunds
    .filter((refund) => refund.state === 'reserved')
    .reduce((total, refund) => total + Number(refund.amount), 0);

export const confirmedRefundTotal = (refunds: SupportRefund[]): number =>
  refunds
    .filter((refund) => refund.state === 'confirmed')
    .reduce((total, refund) => total + Number(refund.amount), 0);

export const canResolveTicket = (refunds: SupportRefund[]): boolean =>
  !refunds.some((refund) => refund.state === 'reserved');
