jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/realtime').createRealtimeSupabaseMock(),
}));

const mockAuthState: { user: { id: string } | null } = { user: { id: 'user-a' } };

jest.mock('@/hooks/use-auth-store', () => ({
  __esModule: true,
  default: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

let mockUuidCounter = 0;

jest.mock('expo-crypto', () => ({
  randomUUID: () => `client-${(mockUuidCounter += 1)}`,
}));

const mockDetails = jest.fn();
const mockMessages = jest.fn();
const mockSendMessage = jest.fn();
const mockRefunds = jest.fn();
const mockMarkRead = jest.fn();

jest.mock('@/services/supportService', () => {
  const actual = jest.requireActual('@/services/supportService');
  return {
    ...actual,
    supportService: {
      ...actual.supportService,
      details: (...args: unknown[]) => mockDetails(...args),
      messages: (...args: unknown[]) => mockMessages(...args),
      sendMessage: (...args: unknown[]) => mockSendMessage(...args),
      refunds: (...args: unknown[]) => mockRefunds(...args),
      markRead: (...args: unknown[]) => mockMarkRead(...args),
    },
  };
});

import { mergeSupportTimeline, useSupportConversation } from '@/hooks/useSupport';
import { bumpSessionEpoch, resetSessionEpochForTests } from '@/utils/sessionGuard';
import type { OutgoingMessage, SupportMessage, SupportTicketDetails } from '@/types/database';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { findChannel, mockChannelRegistry, resetChannelRegistry } from './helpers/realtime';

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const ticket = (overrides: Partial<SupportTicketDetails> = {}): SupportTicketDetails => ({
  id: 'ticket-1',
  order_id: 'order-1',
  user_id: 'user-a',
  restaurant_name: 'Support Kitchen',
  category: 'missing_items',
  status: 'open',
  description: 'One dish was missing',
  assigned_admin_id: null,
  assigned_admin_name: null,
  revision: 1,
  reopened_count: 0,
  created_at: '2026-02-01T10:00:00.000Z',
  updated_at: '2026-02-01T10:00:00.000Z',
  resolved_at: null,
  order_total: 30,
  payment_method: 'card',
  viewer_role: 'customer',
  ...overrides,
});

const message = (overrides: Partial<SupportMessage> = {}): SupportMessage => ({
  id: 'message-1',
  client_message_id: 'client-1',
  sender_role: 'customer',
  body: 'One dish was missing',
  created_at: '2026-02-01T10:00:00.000Z',
  is_mine: true,
  ...overrides,
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  resetChannelRegistry();
  resetSessionEpochForTests();
  mockUuidCounter = 0;
  mockAuthState.user = { id: 'user-a' };
  queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });

  mockDetails.mockResolvedValue(ticket());
  mockMessages.mockResolvedValue({ messages: [], nextCursor: null });
  mockRefunds.mockResolvedValue([]);
  mockSendMessage.mockResolvedValue(message({ id: 'message-sent' }));
  mockMarkRead.mockResolvedValue(undefined);
});

describe('reading a ticket', () => {
  it('loads the conversation once the ticket is readable', async () => {
    mockMessages.mockResolvedValue({ messages: [message()], nextCursor: null });

    const { result } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(mockMessages).toHaveBeenCalledWith('ticket-1', null);
  });

  it('never asks for messages when the ticket is not readable', async () => {
    mockDetails.mockRejectedValue(new Error('You cannot read this ticket'));

    const { result } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });

    await waitFor(() => expect(result.current.ticketError).toBeTruthy());
    expect(result.current.canRead).toBe(false);
    expect(mockMessages).not.toHaveBeenCalled();
  });

  it('asks for nothing while there is no ticket id', async () => {
    renderHook(() => useSupportConversation(undefined), { wrapper });
    await flush();

    expect(mockDetails).not.toHaveBeenCalled();
    expect(mockMessages).not.toHaveBeenCalled();
  });

  it('asks for nothing while nobody is signed in', async () => {
    mockAuthState.user = null;

    renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await flush();

    expect(mockDetails).not.toHaveBeenCalled();
  });
});

describe('sending a message', () => {
  it('shows the message as pending and then as delivered', async () => {
    const { result } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.canRead).toBe(true));

    act(() => result.current.send('Any news?'));
    expect(result.current.outgoing).toHaveLength(1);
    expect(result.current.outgoing[0].state).toBe('pending');

    await waitFor(() => expect(result.current.outgoing).toHaveLength(0));
    expect(mockSendMessage).toHaveBeenCalledWith('ticket-1', 'client-1', 'Any news?');
  });

  it('keeps a failed message so it can be retried', async () => {
    mockSendMessage.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.canRead).toBe(true));

    act(() => result.current.send('Any news?'));
    await waitFor(() => expect(result.current.outgoing[0]?.state).toBe('failed'));

    mockSendMessage.mockResolvedValue(message({ id: 'message-sent' }));
    act(() => result.current.retry('client-1'));

    await waitFor(() => expect(result.current.outgoing).toHaveLength(0));
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(mockSendMessage).toHaveBeenLastCalledWith('ticket-1', 'client-1', 'Any news?');
  });

  it('retries with the same client id so the server stores one message', async () => {
    mockSendMessage.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.canRead).toBe(true));

    act(() => result.current.send('Any news?'));
    await waitFor(() => expect(result.current.outgoing[0]?.state).toBe('failed'));

    act(() => result.current.retry('client-1'));
    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(2));

    const ids = mockSendMessage.mock.calls.map((call) => call[1]);
    expect(new Set(ids).size).toBe(1);
  });

  it('drops a message the sender discards', async () => {
    mockSendMessage.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.canRead).toBe(true));

    act(() => result.current.send('Any news?'));
    await waitFor(() => expect(result.current.outgoing[0]?.state).toBe('failed'));

    act(() => result.current.discard('client-1'));
    expect(result.current.outgoing).toHaveLength(0);
  });

  it('refuses to send an empty message', async () => {
    const { result } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.canRead).toBe(true));

    act(() => result.current.send('    '));

    expect(result.current.outgoing).toHaveLength(0);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('never sends while the ticket cannot be read', async () => {
    mockDetails.mockRejectedValue(new Error('You cannot read this ticket'));

    const { result } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.ticketError).toBeTruthy());

    act(() => result.current.send('Let me in'));

    expect(result.current.outgoing).toHaveLength(0);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

describe('switching accounts', () => {
  it('forgets a pending message when the account changes mid send', async () => {
    let settle: (value: unknown) => void = () => undefined;
    mockSendMessage.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      })
    );

    const { result } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.canRead).toBe(true));

    act(() => result.current.send('Any news?'));
    expect(result.current.outgoing).toHaveLength(1);

    act(() => {
      bumpSessionEpoch();
    });
    await act(async () => {
      settle(message({ id: 'message-sent' }));
      await Promise.resolve();
    });

    expect(result.current.outgoing).toHaveLength(1);
    expect(result.current.outgoing[0].state).toBe('pending');
  });

  it('does not mark a message failed for the next account', async () => {
    let reject: (error: unknown) => void = () => undefined;
    mockSendMessage.mockReturnValue(
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      })
    );

    const { result } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.canRead).toBe(true));

    act(() => result.current.send('Any news?'));

    act(() => {
      bumpSessionEpoch();
    });
    await act(async () => {
      reject(new Error('offline'));
      await Promise.resolve();
    });

    expect(result.current.outgoing[0].state).toBe('pending');
  });

  it('clears unsent messages when the signed in account changes', async () => {
    mockSendMessage.mockRejectedValue(new Error('offline'));

    const { result, rerender } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.canRead).toBe(true));

    act(() => result.current.send('Any news?'));
    await waitFor(() => expect(result.current.outgoing).toHaveLength(1));

    mockAuthState.user = { id: 'user-b' };
    rerender(undefined);
    await flush();

    expect(result.current.outgoing).toHaveLength(0);
  });

  it('drops the first account conversation instead of showing it to the next', async () => {
    mockMessages.mockResolvedValue({
      messages: [message({ id: 'message-a', body: 'Only user a may read this' })],
      nextCursor: null,
    });

    const { result, rerender } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(queryClient.getQueryData(['support-messages', 'ticket-1', 'user-a'])).toBeDefined();

    mockDetails.mockRejectedValue(new Error('You cannot read this ticket'));
    mockAuthState.user = { id: 'user-b' };
    rerender(undefined);

    await waitFor(() =>
      expect(queryClient.getQueryData(['support-messages', 'ticket-1', 'user-a'])).toBeUndefined()
    );
    expect(result.current.messages).toHaveLength(0);
  });

  it('reads the next account conversation under its own key', async () => {
    const { result, rerender } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.canRead).toBe(true));

    mockAuthState.user = { id: 'user-b' };
    rerender(undefined);

    await waitFor(() =>
      expect(queryClient.getQueryData(['support-messages', 'ticket-1', 'user-b'])).toBeDefined()
    );
    expect(mockMessages.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('live updates', () => {
  it('listens to this ticket only', async () => {
    const { result } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.canRead).toBe(true));

    const channel = findChannel('support-ticket-messages-ticket-1');
    expect(channel).toBeDefined();
    expect(mockChannelRegistry.some((entry) => entry.name.includes('ticket-2'))).toBe(false);
  });

  it('refetches the conversation when a message arrives', async () => {
    const { result } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.canRead).toBe(true));

    const channel = findChannel('support-ticket-messages-ticket-1');
    await act(async () => {
      channel?.handlers.forEach((handler) => handler({ new: { id: 'message-2' } }));
      await Promise.resolve();
    });

    await waitFor(() => expect(mockMessages.mock.calls.length).toBeGreaterThan(1));
  });

  it('refetches the ticket and its refunds when the ticket changes', async () => {
    const { result } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.canRead).toBe(true));

    const channel = findChannel('support-ticket-state-ticket-1');
    await act(async () => {
      channel?.handlers.forEach((handler) => handler({ new: { status: 'resolved' } }));
      await Promise.resolve();
    });

    await waitFor(() => expect(mockDetails.mock.calls.length).toBeGreaterThan(1));
  });

  it('opens no channel while the ticket cannot be read', async () => {
    mockDetails.mockRejectedValue(new Error('You cannot read this ticket'));

    const { result } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.ticketError).toBeTruthy());

    expect(mockChannelRegistry).toHaveLength(0);
  });
});

describe('marking a ticket read', () => {
  it('marks the conversation read once it is open', async () => {
    const { result } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.canRead).toBe(true));

    await act(async () => {
      await result.current.markRead();
    });

    expect(mockMarkRead).toHaveBeenCalledWith('ticket-1');
  });

  it('never marks a ticket read that it cannot read', async () => {
    mockDetails.mockRejectedValue(new Error('You cannot read this ticket'));

    const { result } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.ticketError).toBeTruthy());

    await act(async () => {
      await result.current.markRead();
    });

    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it('swallows a failure to mark read instead of breaking the screen', async () => {
    mockMarkRead.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.canRead).toBe(true));

    await act(async () => {
      await expect(result.current.markRead()).resolves.toBeUndefined();
    });
  });

  it('does not refresh the next account ticket list after a switch mid call', async () => {
    let settle: (value: unknown) => void = () => undefined;
    mockMarkRead.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      })
    );

    const { result } = renderHook(() => useSupportConversation('ticket-1'), { wrapper });
    await waitFor(() => expect(result.current.canRead).toBe(true));

    const spy = jest.spyOn(queryClient, 'invalidateQueries');
    const pending = result.current.markRead();

    act(() => {
      bumpSessionEpoch();
    });
    await act(async () => {
      settle(undefined);
      await pending;
    });

    expect(
      spy.mock.calls.filter((call) => JSON.stringify(call[0]).includes('support-tickets'))
    ).toHaveLength(0);
  });
});

describe('the merged timeline', () => {
  it('puts unsent messages at the newest end', () => {
    const delivered = [message({ id: 'message-1', client_message_id: 'client-1' })];
    const pending: OutgoingMessage[] = [
      { client_message_id: 'client-2', body: 'Later', state: 'pending', created_at: 'now' },
    ];

    const timeline = mergeSupportTimeline(delivered, pending);

    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({ client_message_id: 'client-2' });
  });

  it('drops an unsent copy once the server echoes it back', () => {
    const delivered = [message({ id: 'message-1', client_message_id: 'client-1' })];
    const pending: OutgoingMessage[] = [
      { client_message_id: 'client-1', body: 'Same', state: 'pending', created_at: 'now' },
    ];

    expect(mergeSupportTimeline(delivered, pending)).toHaveLength(1);
  });
});
