jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/realtime').createRealtimeSupabaseMock(),
}));

const mockAuthState: { user: { id: string } | null } = { user: { id: 'user-a' } };

jest.mock('@/hooks/use-auth-store', () => ({
  __esModule: true,
  default: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

const mockAccess = jest.fn();
const mockPage = jest.fn();
const mockSend = jest.fn();
const mockMarkRead = jest.fn();

jest.mock('@/services/chatService', () => ({
  CHAT_PAGE_SIZE: 30,
  MESSAGE_MAX_LENGTH: 1000,
  chatService: {
    access: (...args: unknown[]) => mockAccess(...args),
    page: (...args: unknown[]) => mockPage(...args),
    send: (...args: unknown[]) => mockSend(...args),
    markRead: (...args: unknown[]) => mockMarkRead(...args),
    unreadTotals: () => Promise.resolve([]),
    unreadCount: () => Promise.resolve(0),
  },
}));

import { useOrderChat } from '@/hooks/useOrderChat';
import { bumpSessionEpoch, resetSessionEpochForTests } from '@/utils/sessionGuard';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { findChannel, mockChannelRegistry, resetChannelRegistry } from './helpers/realtime';

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const openAccess = {
  can_read: true,
  can_send: true,
  chat_role: 'customer',
  courier_assigned: true,
  order_status: 'delivering',
  counterpart_name: 'Courier A',
  reason: 'open',
};

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
  mockAuthState.user = { id: 'user-a' };
  queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });

  mockAccess.mockResolvedValue(openAccess);
  mockPage.mockResolvedValue({ messages: [], nextCursor: null });
  mockSend.mockResolvedValue({ id: 'm1', client_message_id: 'c1' });
  mockMarkRead.mockResolvedValue(undefined);
});

describe('subscription scoping', () => {
  it('subscribes to the conversation it was given', async () => {
    renderHook(() => useOrderChat('order-1'), { wrapper });

    await waitFor(() => expect(findChannel('order-chat-order-')).toBeDefined());
    expect(findChannel('order-chat-order-')?.name).toBe('order-chat-order-1');
  });

  it('does not subscribe without a signed in account', async () => {
    mockAuthState.user = null;

    renderHook(() => useOrderChat('order-1'), { wrapper });
    await flush();

    expect(
      mockChannelRegistry.filter((channel) => !channel.name.includes('none'))
    ).toHaveLength(0);
  });

  it('does not subscribe when the account may not read the conversation', async () => {
    mockAccess.mockResolvedValue({ ...openAccess, can_read: false, reason: 'no_access' });

    const { result } = renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(result.current.canRead).toBe(false));

    expect(
      mockChannelRegistry.filter((channel) => !channel.name.includes('none'))
    ).toHaveLength(0);
  });

  it('never fetches history without read access', async () => {
    mockAccess.mockResolvedValue({ ...openAccess, can_read: false });

    renderHook(() => useOrderChat('order-1'), { wrapper });
    await flush();

    expect(mockPage).not.toHaveBeenCalled();
  });
});

describe('cleanup', () => {
  it('removes the channel on unmount', async () => {
    const view = renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(findChannel('order-chat-order-')).toBeDefined());

    view.unmount();

    expect(findChannel('order-chat-order-')?.removed).toBe(true);
  });

  it('tears down the subscription when the account changes', async () => {
    const view = renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(findChannel('order-chat-order-')).toBeDefined());

    mockAuthState.user = null;
    view.rerender(undefined);

    await waitFor(() => expect(findChannel('order-chat-order-')?.removed).toBe(true));
  });

  it('tears down the subscription when assignment is lost', async () => {
    const view = renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(findChannel('order-chat-order-')).toBeDefined());

    mockAccess.mockResolvedValue({ ...openAccess, can_read: false, reason: 'no_access' });
    await act(async () => {
      await view.result.current.refetchAccess();
    });

    await waitFor(() => expect(findChannel('order-chat-order-')?.removed).toBe(true));
  });

  it('clears cached messages when access is lost', async () => {
    mockPage.mockResolvedValue({
      messages: [
        {
          id: 'm1',
          client_message_id: 'c1',
          sender_id: 'user-a',
          sender_role: 'customer',
          body: 'secret',
          created_at: '2026-01-01T10:00:00.000Z',
          is_mine: true,
        },
      ],
      nextCursor: null,
    });

    const view = renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(view.result.current.messages).toHaveLength(1));

    mockAccess.mockResolvedValue({ ...openAccess, can_read: false, reason: 'no_access' });
    await act(async () => {
      await view.result.current.refetchAccess();
    });

    await waitFor(() => expect(view.result.current.messages).toHaveLength(0));
    expect(queryClient.getQueryData(['order-chat', 'order-1', 'user-a'])).toBeUndefined();
  });
});

describe('optimistic sending', () => {
  it('shows a pending message immediately', async () => {
    let resolveSend: (value: unknown) => void = () => undefined;
    mockSend.mockReturnValue(new Promise((resolve) => {
      resolveSend = resolve;
    }));

    const { result } = renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(result.current.canSend).toBe(true));

    act(() => result.current.send('Hello there'));

    expect(result.current.outgoing).toHaveLength(1);
    expect(result.current.outgoing[0].state).toBe('pending');

    await act(async () => {
      resolveSend({ id: 'm1' });
      await Promise.resolve();
    });
  });

  it('marks a message failed when the send is refused', async () => {
    mockSend.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      result.current.send('Hello there');
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.outgoing[0]?.state).toBe('failed'));
  });

  it('retries with the same client message id', async () => {
    mockSend.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      result.current.send('Hello there');
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.outgoing[0]?.state).toBe('failed'));

    const clientId = result.current.outgoing[0].client_message_id;
    mockSend.mockResolvedValue({ id: 'm1', client_message_id: clientId });

    await act(async () => {
      result.current.retry(clientId);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSend.mock.calls[0][1]).toBe(clientId);
    expect(mockSend.mock.calls[1][1]).toBe(clientId);
  });

  it('refuses to send when the order no longer accepts messages', async () => {
    mockAccess.mockResolvedValue({ ...openAccess, can_send: false, reason: 'order_closed' });

    const { result } = renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(result.current.canSend).toBe(false));

    act(() => result.current.send('Hello there'));

    expect(mockSend).not.toHaveBeenCalled();
    expect(result.current.outgoing).toHaveLength(0);
  });

  it('ignores a blank message', async () => {
    const { result } = renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(result.current.canSend).toBe(true));

    act(() => result.current.send('    '));

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('discards a failed message when asked', async () => {
    mockSend.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(result.current.canSend).toBe(true));

    await act(async () => {
      result.current.send('Hello there');
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.outgoing).toHaveLength(1));

    act(() => result.current.discard(result.current.outgoing[0].client_message_id));

    expect(result.current.outgoing).toHaveLength(0);
  });
});

describe('account isolation during send', () => {
  it('does not mark a message failed in the next account after a switch', async () => {
    let rejectSend: (reason: unknown) => void = () => undefined;
    mockSend.mockReturnValue(new Promise((_resolve, reject) => {
      rejectSend = reject;
    }));

    const { result } = renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(result.current.canSend).toBe(true));

    act(() => result.current.send('Hello there'));
    expect(result.current.outgoing).toHaveLength(1);

    act(() => {
      bumpSessionEpoch();
    });

    await act(async () => {
      rejectSend(new Error('offline'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.outgoing[0].state).toBe('pending');
  });

  it('clears pending messages when the account changes', async () => {
    mockSend.mockReturnValue(new Promise(() => undefined));

    const view = renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(view.result.current.canSend).toBe(true));

    act(() => view.result.current.send('Hello there'));
    expect(view.result.current.outgoing).toHaveLength(1);

    mockAuthState.user = { id: 'user-b' };
    view.rerender(undefined);

    await waitFor(() => expect(view.result.current.outgoing).toHaveLength(0));
  });
});

describe('recovery', () => {
  it('reports a dropped realtime connection', async () => {
    const { result } = renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(findChannel('order-chat-order-')).toBeDefined());

    await act(async () => {
      findChannel('order-chat-order-')?.statusCallback?.('CHANNEL_ERROR');
      await Promise.resolve();
    });

    expect(result.current.connection).toBe('disconnected');
  });

  it('refetches history after reconnecting', async () => {
    renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(mockPage).toHaveBeenCalled());

    const before = mockPage.mock.calls.length;

    await act(async () => {
      findChannel('order-chat-order-')?.statusCallback?.('SUBSCRIBED');
      await Promise.resolve();
    });

    await waitFor(() => expect(mockPage.mock.calls.length).toBeGreaterThan(before));
  });

  it('refreshes history and access on demand', async () => {
    const { result } = renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(mockPage).toHaveBeenCalled());

    const pageCalls = mockPage.mock.calls.length;
    const accessCalls = mockAccess.mock.calls.length;

    await act(async () => {
      result.current.refresh();
      await Promise.resolve();
    });

    await waitFor(() => expect(mockPage.mock.calls.length).toBeGreaterThan(pageCalls));
    expect(mockAccess.mock.calls.length).toBeGreaterThan(accessCalls);
  });
});

describe('closing the conversation in realtime', () => {
  it('subscribes to the order status so a closure reaches the composer', async () => {
    renderHook(() => useOrderChat('order-1'), { wrapper });

    await waitFor(() => expect(findChannel('order-chat-status-')).toBeDefined());
    expect(findChannel('order-chat-status-')?.name).toBe('order-chat-status-order-1');
  });

  it('subscribes to assignment changes so a reassignment reaches the composer', async () => {
    renderHook(() => useOrderChat('order-1'), { wrapper });

    await waitFor(() => expect(findChannel('order-chat-assignment-')).toBeDefined());
  });

  it('disables the composer once the order reports as closed', async () => {
    const { result } = renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(result.current.canSend).toBe(true));

    mockAccess.mockResolvedValue({
      ...openAccess,
      can_send: false,
      order_status: 'delivered',
      reason: 'order_closed',
    });

    await act(async () => {
      findChannel('order-chat-status-')?.handlers.forEach((handler) =>
        handler({ new: { id: 'order-1', status: 'delivered' } })
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.canSend).toBe(false));
    expect(result.current.canRead).toBe(true);
  });

  it('stops accepting sends the moment the composer closes', async () => {
    const { result } = renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(result.current.canSend).toBe(true));

    mockAccess.mockResolvedValue({ ...openAccess, can_send: false, reason: 'order_closed' });
    await act(async () => {
      await result.current.refetchAccess();
    });
    await waitFor(() => expect(result.current.canSend).toBe(false));

    const before = mockSend.mock.calls.length;
    act(() => result.current.send('too late'));

    expect(mockSend.mock.calls.length).toBe(before);
  });

  it('tears down the status subscriptions on unmount', async () => {
    const view = renderHook(() => useOrderChat('order-1'), { wrapper });
    await waitFor(() => expect(findChannel('order-chat-status-')).toBeDefined());

    view.unmount();

    expect(findChannel('order-chat-status-')?.removed).toBe(true);
    expect(findChannel('order-chat-assignment-')?.removed).toBe(true);
  });
});
