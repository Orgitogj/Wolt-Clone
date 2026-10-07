jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

import { chatService } from '@/services/chatService';
import { mergeChatTimeline } from '@/hooks/useOrderChat';
import {
  canOpenDestination,
  destinationFromNotificationData,
  peekPendingDestination,
  setPendingDestination,
  takePendingDestination,
} from '@/hooks/useNotificationRouting';
import { supabase } from '@/lib/supabase';
import type { OrderMessage, OutgoingMessage } from '@/types/database';
import type { SupabaseMock } from './helpers/supabase';

const mocked = supabase as unknown as SupabaseMock;

const rpcResult = (data: unknown) => Promise.resolve({ data, error: null });

const message = (overrides: Partial<OrderMessage> = {}): OrderMessage => ({
  id: 'message-1',
  client_message_id: 'client-1',
  sender_id: 'user-a',
  sender_role: 'customer',
  body: 'Hello',
  created_at: '2026-01-01T10:00:00.000Z',
  is_mine: true,
  ...overrides,
});

const outgoing = (overrides: Partial<OutgoingMessage> = {}): OutgoingMessage => ({
  client_message_id: 'client-pending',
  body: 'Pending message',
  state: 'pending',
  created_at: '2026-01-01T10:05:00.000Z',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  setPendingDestination(null);
});

describe('access', () => {
  it('asks the server who may use the conversation', async () => {
    mocked.rpc.mockReturnValue(
      rpcResult([{ can_read: true, can_send: true, chat_role: 'customer', reason: 'open' }])
    );

    const access = await chatService.access('order-1');

    expect(mocked.rpc).toHaveBeenCalledWith('order_chat_access', { p_order_id: 'order-1' });
    expect(access.can_send).toBe(true);
  });

  it('denies access when the server returns nothing', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    const access = await chatService.access('order-1');

    expect(access.can_read).toBe(false);
    expect(access.can_send).toBe(false);
    expect(access.reason).toBe('no_access');
  });

  it('never reads the conversation table directly', async () => {
    mocked.rpc.mockReturnValue(rpcResult([{ can_read: true }]));

    await chatService.access('order-1');

    expect(mocked.from).not.toHaveBeenCalled();
  });
});

describe('history paging', () => {
  it('requests the first page without a cursor', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    await chatService.page('order-1');

    expect(mocked.rpc).toHaveBeenCalledWith('order_messages_page', {
      p_order_id: 'order-1',
      p_before_created_at: null,
      p_before_id: null,
      p_limit: 30,
    });
  });

  it('pages with a created_at and id tie breaker', async () => {
    mocked.rpc.mockReturnValue(
      rpcResult(
        Array.from({ length: 30 }, (_, index) =>
          message({ id: `m-${index}`, created_at: '2026-01-01T10:00:00.000Z' })
        )
      )
    );

    const page = await chatService.page('order-1');

    expect(page.nextCursor).toEqual({ createdAt: '2026-01-01T10:00:00.000Z', id: 'm-29' });
  });

  it('sends the cursor back on the next page', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    await chatService.page('order-1', { createdAt: '2026-01-01T10:00:00.000Z', id: 'm-29' });

    expect(mocked.rpc.mock.calls[0][1]).toMatchObject({
      p_before_created_at: '2026-01-01T10:00:00.000Z',
      p_before_id: 'm-29',
    });
  });

  it('stops paging on a short page', async () => {
    mocked.rpc.mockReturnValue(rpcResult([message()]));

    const page = await chatService.page('order-1');

    expect(page.nextCursor).toBeNull();
  });

  it('propagates an unauthorised history read', async () => {
    mocked.rpc.mockReturnValue(
      Promise.resolve({ data: null, error: new Error('You cannot read this conversation') })
    );

    await expect(chatService.page('order-1')).rejects.toThrow('cannot read this conversation');
  });
});

describe('sending', () => {
  it('sends the client generated id so the server can deduplicate', async () => {
    mocked.rpc.mockReturnValue(rpcResult(message()));

    await chatService.send('order-1', 'client-1', 'Hello');

    expect(mocked.rpc).toHaveBeenCalledWith('send_order_message', {
      p_order_id: 'order-1',
      p_client_message_id: 'client-1',
      p_body: 'Hello',
    });
  });

  it('never sends a sender id or role from the client', async () => {
    mocked.rpc.mockReturnValue(rpcResult(message()));

    await chatService.send('order-1', 'client-1', 'Hello');

    const payload = mocked.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('p_sender_id');
    expect(payload).not.toHaveProperty('p_sender_role');
    expect(payload).not.toHaveProperty('p_recipient_id');
    expect(Object.keys(payload)).toEqual([
      'p_order_id',
      'p_client_message_id',
      'p_body',
    ]);
  });

  it('retrying uses the same client id', async () => {
    mocked.rpc.mockReturnValue(rpcResult(message()));

    await chatService.send('order-1', 'client-1', 'Hello');
    await chatService.send('order-1', 'client-1', 'Hello');

    expect(mocked.rpc.mock.calls[0][1]).toMatchObject({ p_client_message_id: 'client-1' });
    expect(mocked.rpc.mock.calls[1][1]).toMatchObject({ p_client_message_id: 'client-1' });
  });

  it('surfaces a refused send', async () => {
    mocked.rpc.mockReturnValue(
      Promise.resolve({ data: null, error: new Error('This order is closed') })
    );

    await expect(chatService.send('order-1', 'client-1', 'Hi')).rejects.toThrow('closed');
  });
});

describe('read position and unread counts', () => {
  it('marks the conversation read on the server', async () => {
    mocked.rpc.mockReturnValue(rpcResult(null));

    await chatService.markRead('order-1');

    expect(mocked.rpc).toHaveBeenCalledWith('mark_order_messages_read', { p_order_id: 'order-1' });
  });

  it('reads the unread count for one order', async () => {
    mocked.rpc.mockReturnValue(rpcResult(3));

    expect(await chatService.unreadCount('order-1')).toBe(3);
  });

  it('reads unread totals across orders', async () => {
    mocked.rpc.mockReturnValue(rpcResult([{ order_id: 'order-1', unread_count: 2 }]));

    const totals = await chatService.unreadTotals();

    expect(mocked.rpc).toHaveBeenCalledWith('order_chat_unread_totals');
    expect(totals).toEqual([{ order_id: 'order-1', unread_count: 2 }]);
  });

  it('treats a missing count as zero', async () => {
    mocked.rpc.mockReturnValue(rpcResult(null));

    expect(await chatService.unreadCount('order-1')).toBe(0);
  });
});

describe('optimistic reconciliation', () => {
  it('shows a pending message that the server has not confirmed', () => {
    const timeline = mergeChatTimeline([], [outgoing()]);

    expect(timeline).toHaveLength(1);
    expect((timeline[0] as OutgoingMessage).state).toBe('pending');
  });

  it('drops the optimistic copy once the server message arrives', () => {
    const confirmed = message({ client_message_id: 'client-pending' });
    const timeline = mergeChatTimeline([confirmed], [outgoing({ client_message_id: 'client-pending' })]);

    expect(timeline).toHaveLength(1);
    expect((timeline[0] as OrderMessage).id).toBe('message-1');
  });

  it('never shows the same message twice when realtime and the fetch both deliver it', () => {
    const confirmed = message({ client_message_id: 'client-pending' });
    const timeline = mergeChatTimeline(
      [confirmed],
      [outgoing({ client_message_id: 'client-pending', state: 'failed' })]
    );

    expect(timeline).toHaveLength(1);
  });

  it('keeps unrelated pending messages while one is confirmed', () => {
    const confirmed = message({ client_message_id: 'client-a' });
    const timeline = mergeChatTimeline(
      [confirmed],
      [outgoing({ client_message_id: 'client-a' }), outgoing({ client_message_id: 'client-b' })]
    );

    expect(timeline).toHaveLength(2);
    expect((timeline[0] as OutgoingMessage).client_message_id).toBe('client-b');
  });

  it('puts pending messages at the newest end of an inverted timeline', () => {
    const older = message({ id: 'old', client_message_id: 'client-old' });
    const timeline = mergeChatTimeline([older], [outgoing({ client_message_id: 'client-new' })]);

    expect((timeline[0] as OutgoingMessage).client_message_id).toBe('client-new');
    expect((timeline[1] as OrderMessage).id).toBe('old');
  });
});

describe('notification destinations', () => {
  it('builds a destination from a chat notification', () => {
    expect(
      destinationFromNotificationData({ route: '/order/chat', order_id: 'order-1' })
    ).toEqual({ route: '/order/chat', orderId: 'order-1' });
  });

  it('ignores a notification without an order', () => {
    expect(destinationFromNotificationData({ route: '/order/chat' })).toBeNull();
  });

  it('ignores a notification for another route', () => {
    expect(
      destinationFromNotificationData({ route: '/order/track', order_id: 'order-1' })
    ).toBeNull();
  });

  it('ignores empty notification data', () => {
    expect(destinationFromNotificationData(null)).toBeNull();
    expect(destinationFromNotificationData(undefined)).toBeNull();
    expect(destinationFromNotificationData({})).toBeNull();
  });

  it('holds a destination until it is taken once', () => {
    setPendingDestination({ route: '/order/chat', orderId: 'order-1' });

    expect(peekPendingDestination()).toEqual({ route: '/order/chat', orderId: 'order-1' });
    expect(takePendingDestination()).toEqual({ route: '/order/chat', orderId: 'order-1' });
    expect(takePendingDestination()).toBeNull();
  });

  it('rechecks authorisation before opening a destination', async () => {
    mocked.rpc.mockReturnValue(rpcResult([{ can_read: true }]));

    const allowed = await canOpenDestination({ route: '/order/chat', orderId: 'order-1' });

    expect(allowed).toBe(true);
    expect(mocked.rpc).toHaveBeenCalledWith('order_chat_access', { p_order_id: 'order-1' });
  });

  it('refuses a destination the account may no longer open', async () => {
    mocked.rpc.mockReturnValue(rpcResult([{ can_read: false, reason: 'no_access' }]));

    expect(await canOpenDestination({ route: '/order/chat', orderId: 'order-1' })).toBe(false);
  });

  it('refuses a destination when the check itself fails', async () => {
    mocked.rpc.mockReturnValue(Promise.resolve({ data: null, error: new Error('offline') }));

    expect(await canOpenDestination({ route: '/order/chat', orderId: 'order-1' })).toBe(false);
  });

  it('an old notification never opens a conversation the courier lost', async () => {
    mocked.rpc.mockReturnValue(rpcResult([{ can_read: false, reason: 'no_access' }]));

    const allowed = await canOpenDestination({ route: '/order/chat', orderId: 'order-1' });

    expect(allowed).toBe(false);
  });
});
