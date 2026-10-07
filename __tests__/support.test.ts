jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

import { supabase } from '@/lib/supabase';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_MESSAGE_PAGE_SIZE,
  canResolveTicket,
  confirmedRefundTotal,
  describeReportBlocker,
  isRefundWithinBalance,
  needsReportedItems,
  openRefundTotal,
  parseRefundAmount,
  supportService,
} from '@/services/supportService';
import type { SupportRefund } from '@/types/database';
import type { SupabaseMock } from './helpers/supabase';

const mocked = supabase as unknown as SupabaseMock;

const rpcResult = (data: unknown) => Promise.resolve({ data, error: null });
const rpcError = (message: string) =>
  Promise.resolve({ data: null, error: { message } as unknown });

const refund = (overrides: Partial<SupportRefund> = {}): SupportRefund => ({
  id: 'refund-1',
  amount: 5,
  currency: 'EUR',
  method: 'card',
  liability: 'platform',
  state: 'reserved',
  reason: 'missing dish',
  failure_reason: null,
  approved_at: '2026-02-01T10:00:00.000Z',
  settled_at: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reporting eligibility', () => {
  it('asks the server whether the order may be reported', async () => {
    mocked.rpc.mockReturnValue(
      rpcResult([{ can_report: true, reason: 'eligible', open_ticket_id: null, closes_at: null }])
    );

    const eligibility = await supportService.eligibility('order-1');

    expect(mocked.rpc).toHaveBeenCalledWith('support_report_eligibility', {
      p_order_id: 'order-1',
    });
    expect(eligibility.can_report).toBe(true);
  });

  it('refuses when the server returns nothing', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    const eligibility = await supportService.eligibility('order-1');

    expect(eligibility.can_report).toBe(false);
    expect(eligibility.reason).toBe('unknown_order');
  });

  it('explains every blocker the server can return', () => {
    const reasons = [
      'not_your_order',
      'unknown_order',
      'not_delivered_yet',
      'too_old',
      'already_open',
      'too_many_tickets',
    ];

    reasons.forEach((reason) => {
      expect(describeReportBlocker(reason)).not.toMatch(/undefined/);
      expect(describeReportBlocker(reason).length).toBeGreaterThan(0);
    });

    expect(describeReportBlocker('something_new')).toMatch(/cannot report/);
  });
});

describe('submitting a report', () => {
  it('sends the category, description and the reported items', async () => {
    mocked.rpc.mockReturnValue(rpcResult({ id: 'ticket-1' }));

    await supportService.submit('order-1', 'client-1', 'missing_items', 'One dish was missing', [
      { order_item_id: 'item-1', quantity: 2 },
    ]);

    expect(mocked.rpc).toHaveBeenCalledWith('submit_support_ticket', {
      p_order_id: 'order-1',
      p_client_ticket_id: 'client-1',
      p_category: 'missing_items',
      p_description: 'One dish was missing',
      p_items: [{ order_item_id: 'item-1', quantity: 2 }],
    });
  });

  it('carries the same report id so a retry cannot report twice', async () => {
    mocked.rpc.mockReturnValue(rpcResult({ id: 'ticket-1' }));

    await supportService.submit('order-1', 'client-1', 'other', 'Something went wrong');
    await supportService.submit('order-1', 'client-1', 'other', 'Something went wrong');

    const keys = mocked.rpc.mock.calls.map((call) => (call[1] as { p_client_ticket_id: string }).p_client_ticket_id);
    expect(keys).toEqual(['client-1', 'client-1']);
  });

  it('surfaces a refusal from the server', async () => {
    mocked.rpc.mockReturnValue(rpcError('You already have an open report for this order'));

    await expect(
      supportService.submit('order-1', 'client-1', 'other', 'Another problem')
    ).rejects.toMatchObject({ message: expect.stringContaining('already have an open report') });
  });

  it('only asks for items on the categories that have them', () => {
    expect(needsReportedItems('missing_items')).toBe(true);
    expect(needsReportedItems('incorrect_items')).toBe(true);
    expect(needsReportedItems('late_delivery')).toBe(false);
    expect(needsReportedItems('not_delivered')).toBe(false);
    expect(needsReportedItems('other')).toBe(false);
  });

  it('offers every category the server accepts', () => {
    expect(SUPPORT_CATEGORIES.map((option) => option.value)).toEqual([
      'missing_items',
      'incorrect_items',
      'late_delivery',
      'not_delivered',
      'other',
    ]);
  });
});

describe('the conversation', () => {
  it('pages the conversation with a keyset cursor', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    await supportService.messages('ticket-1', {
      createdAt: '2026-02-01T10:00:00.000Z',
      id: 'message-9',
    });

    expect(mocked.rpc).toHaveBeenCalledWith('support_messages_page', {
      p_ticket_id: 'ticket-1',
      p_before_created_at: '2026-02-01T10:00:00.000Z',
      p_before_id: 'message-9',
      p_limit: SUPPORT_MESSAGE_PAGE_SIZE,
    });
  });

  it('stops paging once a short page comes back', async () => {
    mocked.rpc.mockReturnValue(
      rpcResult([
        {
          id: 'message-1',
          client_message_id: 'client-1',
          sender_role: 'admin',
          body: 'Looking into it',
          created_at: '2026-02-01T10:00:00.000Z',
          is_mine: false,
        },
      ])
    );

    const page = await supportService.messages('ticket-1');

    expect(page.messages).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('keeps paging while a full page comes back', async () => {
    const messages = Array.from({ length: SUPPORT_MESSAGE_PAGE_SIZE }, (_, index) => ({
      id: `message-${index}`,
      client_message_id: `client-${index}`,
      sender_role: 'customer' as const,
      body: 'Hello',
      created_at: '2026-02-01T10:00:00.000Z',
      is_mine: true,
    }));
    mocked.rpc.mockReturnValue(rpcResult(messages));

    const page = await supportService.messages('ticket-1');

    expect(page.nextCursor).toEqual({
      createdAt: '2026-02-01T10:00:00.000Z',
      id: `message-${SUPPORT_MESSAGE_PAGE_SIZE - 1}`,
    });
  });

  it('sends a message with its own client id', async () => {
    mocked.rpc.mockReturnValue(rpcResult({ id: 'message-1' }));

    await supportService.sendMessage('ticket-1', 'client-9', 'Any news?');

    expect(mocked.rpc).toHaveBeenCalledWith('send_support_message', {
      p_ticket_id: 'ticket-1',
      p_client_message_id: 'client-9',
      p_body: 'Any news?',
    });
  });

  it('never reads the support tables directly', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    await supportService.messages('ticket-1');
    await supportService.myTickets();
    await supportService.refunds('ticket-1');

    expect(mocked.from).not.toHaveBeenCalled();
  });
});

describe('marking a ticket read', () => {
  it('asks the server to move the read marker', async () => {
    mocked.rpc.mockReturnValue(rpcResult(null));

    await supportService.markRead('ticket-1');

    expect(mocked.rpc).toHaveBeenCalledWith('mark_support_messages_read', {
      p_ticket_id: 'ticket-1',
    });
  });

  it('surfaces a refusal rather than pretending the ticket was read', async () => {
    mocked.rpc.mockReturnValue(rpcError('You cannot read this ticket'));

    await expect(supportService.markRead('ticket-1')).rejects.toMatchObject({
      message: 'You cannot read this ticket',
    });
  });

  it('reads the unread count as a number', async () => {
    mocked.rpc.mockReturnValue(rpcResult('3'));

    await expect(supportService.unreadCount('ticket-1')).resolves.toBe(3);
  });

  it('treats a missing unread count as nothing unread', async () => {
    mocked.rpc.mockReturnValue(rpcResult(null));

    await expect(supportService.unreadCount('ticket-1')).resolves.toBe(0);
  });
});

describe('ticket details', () => {
  it('refuses to invent a ticket the server will not return', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    await expect(supportService.details('ticket-1')).rejects.toThrow(/not available/);
  });

  it('returns the first row the server sends', async () => {
    mocked.rpc.mockReturnValue(rpcResult([{ id: 'ticket-1', viewer_role: 'customer' }]));

    const ticket = await supportService.details('ticket-1');

    expect(ticket.id).toBe('ticket-1');
    expect(ticket.viewer_role).toBe('customer');
  });

  it('passes a refusal straight through', async () => {
    mocked.rpc.mockReturnValue(rpcError('You cannot read this ticket'));

    await expect(supportService.details('ticket-1')).rejects.toMatchObject({
      message: 'You cannot read this ticket',
    });
  });
});

describe('the admin queue', () => {
  it('sends every filter the screen offers', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    await supportService.adminTickets({
      status: 'open',
      category: 'missing_items',
      assignment: 'mine',
    });

    expect(mocked.rpc).toHaveBeenCalledWith('admin_support_tickets', {
      p_status: 'open',
      p_category: 'missing_items',
      p_assignment: 'mine',
      p_limit: 20,
      p_offset: 0,
    });
  });

  it('treats showing everyone as no assignment filter', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    await supportService.adminTickets({ status: null, category: null, assignment: 'all' });

    expect(mocked.rpc).toHaveBeenCalledWith(
      'admin_support_tickets',
      expect.objectContaining({ p_status: null, p_category: null, p_assignment: null })
    );
  });

  it('pages by offset while full pages come back', async () => {
    mocked.rpc.mockReturnValue(
      rpcResult(Array.from({ length: 20 }, (_, index) => ({ id: `ticket-${index}` })))
    );

    const page = await supportService.adminTickets(
      { status: null, category: null, assignment: 'all' },
      20
    );

    expect(page.nextOffset).toBe(40);
  });
});

describe('admin actions', () => {
  it('sends the revision it saw so a stale screen cannot overwrite', async () => {
    mocked.rpc.mockReturnValue(rpcResult({ id: 'ticket-1' }));

    await supportService.assign('ticket-1', 'admin-1', 4);
    await supportService.setStatus('ticket-1', 'resolved', 4, 'refunded');

    expect(mocked.rpc).toHaveBeenNthCalledWith(1, 'admin_assign_support_ticket', {
      p_ticket_id: 'ticket-1',
      p_admin_id: 'admin-1',
      p_expected_revision: 4,
    });
    expect(mocked.rpc).toHaveBeenNthCalledWith(2, 'admin_set_support_status', {
      p_ticket_id: 'ticket-1',
      p_status: 'resolved',
      p_expected_revision: 4,
      p_note: 'refunded',
    });
  });

  it('approves a refund with its own request id', async () => {
    mocked.rpc.mockReturnValue(rpcResult({ id: 'refund-1' }));

    await supportService.approveRefund('ticket-1', 7.5, 'missing dish', 'restaurant', 'request-1');

    expect(mocked.rpc).toHaveBeenCalledWith('admin_approve_support_refund', {
      p_ticket_id: 'ticket-1',
      p_amount: 7.5,
      p_reason: 'missing dish',
      p_liability: 'restaurant',
      p_client_request_id: 'request-1',
    });
  });

  it('confirms a cash refund with a settlement note', async () => {
    mocked.rpc.mockReturnValue(rpcResult({ id: 'refund-1' }));

    await supportService.confirmCashRefund('refund-1', 'handed back at the door');

    expect(mocked.rpc).toHaveBeenCalledWith('admin_confirm_cash_refund', {
      p_refund_id: 'refund-1',
      p_reason: 'handed back at the door',
    });
  });

  it('surfaces the server refusing an unauthorised refund', async () => {
    mocked.rpc.mockReturnValue(rpcError('Only an administrator can do this'));

    await expect(
      supportService.approveRefund('ticket-1', 5, 'why', 'platform', 'request-1')
    ).rejects.toMatchObject({ message: 'Only an administrator can do this' });
  });
});

describe('refund amounts entered by hand', () => {
  it('accepts plain amounts and both decimal separators', () => {
    expect(parseRefundAmount('5')).toBe(5);
    expect(parseRefundAmount('5.5')).toBe(5.5);
    expect(parseRefundAmount('4,25')).toBe(4.25);
    expect(parseRefundAmount(' 10.00 ')).toBe(10);
  });

  it('rejects anything that is not a positive money amount', () => {
    ['', '   ', '0', '-3', 'abc', '1.234', '1e3', '5..5', '.5'].forEach((input) => {
      expect(parseRefundAmount(input)).toBeNull();
    });
  });

  it('keeps the amount inside the remaining balance', () => {
    expect(isRefundWithinBalance(10, 10)).toBe(true);
    expect(isRefundWithinBalance(9.99, 10)).toBe(true);
    expect(isRefundWithinBalance(10.01, 10)).toBe(false);
  });

  it('compares in cents so floating point cannot leak a cent', () => {
    expect(isRefundWithinBalance(0.1 + 0.2, 0.3)).toBe(true);
  });
});

describe('refund totals shown to people', () => {
  it('counts only what is still being processed as pending', () => {
    const refunds = [
      refund({ id: 'a', amount: 5, state: 'reserved' }),
      refund({ id: 'b', amount: 3, state: 'confirmed' }),
      refund({ id: 'c', amount: 2, state: 'failed' }),
      refund({ id: 'd', amount: 1, state: 'cancelled' }),
    ];

    expect(openRefundTotal(refunds)).toBe(5);
    expect(confirmedRefundTotal(refunds)).toBe(3);
  });

  it('blocks resolving while a refund is still being processed', () => {
    expect(canResolveTicket([refund({ state: 'reserved' })])).toBe(false);
    expect(canResolveTicket([refund({ state: 'confirmed' })])).toBe(true);
    expect(canResolveTicket([refund({ state: 'failed' })])).toBe(true);
    expect(canResolveTicket([])).toBe(true);
  });
});
