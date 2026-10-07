jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

const mockAuthState: { user: { id: string } | null } = { user: null };

jest.mock('@/hooks/use-auth-store', () => ({
  __esModule: true,
  default: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

const mockSessionState = { isRestored: false };

jest.mock('@/hooks/use-session-store', () => ({
  useIsSessionRestored: () => mockSessionState.isRestored,
  useSessionStore: {
    getState: () => mockSessionState,
    setState: (patch: Partial<typeof mockSessionState>) => Object.assign(mockSessionState, patch),
  },
}));

const mockResponseListeners: ((response: unknown) => void)[] = [];

jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => {
    mockResponseListeners.push(listener);
    return { remove: jest.fn() };
  },
}));

import {
  destinationFromNotificationData,
  peekPendingDestination,
  setPendingDestination,
  useNotificationRouting,
} from '@/hooks/useNotificationRouting';
import { supabase } from '@/lib/supabase';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { SupabaseMock } from './helpers/supabase';

const mocked = supabase as unknown as SupabaseMock;

const allowAccess = () =>
  mocked.rpc.mockReturnValue(Promise.resolve({ data: [{ can_read: true }], error: null }));

const denyAccess = () =>
  mocked.rpc.mockReturnValue(
    Promise.resolve({ data: [{ can_read: false, reason: 'no_access' }], error: null })
  );

const tapNotification = async (data: unknown) => {
  await act(async () => {
    mockResponseListeners.forEach((listener) =>
      listener({ notification: { request: { content: { data } } } })
    );
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockResponseListeners.length = 0;
  mockAuthState.user = null;
  mockSessionState.isRestored = false;
  setPendingDestination(null);
});

describe('malformed notification data', () => {
  it.each([
    [null],
    [undefined],
    [{}],
    [{ route: '/order/chat' }],
    [{ order_id: 'order-1' }],
    [{ route: 42, order_id: 'order-1' }],
    [{ route: '/order/chat', order_id: 99 }],
    [{ route: '/order/track', order_id: 'order-1' }],
  ])('never builds a destination from %p', (data) => {
    expect(destinationFromNotificationData(data as never)).toBeNull();
  });

  it('ignores a malformed tap without navigating or calling the server', async () => {
    mockAuthState.user = { id: 'user-a' };
    mockSessionState.isRestored = true;
    renderHook(() => useNotificationRouting());

    await tapNotification({ route: '/order/chat' });

    expect(mockPush).not.toHaveBeenCalled();
    expect(mocked.rpc).not.toHaveBeenCalled();
  });
});

describe('signed in navigation', () => {
  it('opens an authorised conversation', async () => {
    mockAuthState.user = { id: 'user-a' };
    mockSessionState.isRestored = true;
    allowAccess();

    renderHook(() => useNotificationRouting());
    await tapNotification({ route: '/order/chat', order_id: 'order-1' });

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/order/chat',
        params: { id: 'order-1' },
      })
    );
  });

  it('refuses to open a conversation the account may not read', async () => {
    mockAuthState.user = { id: 'user-a' };
    mockSessionState.isRestored = true;
    denyAccess();

    renderHook(() => useNotificationRouting());
    await tapNotification({ route: '/order/chat', order_id: 'order-1' });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('refuses to open when the authorisation check itself fails', async () => {
    mockAuthState.user = { id: 'user-a' };
    mockSessionState.isRestored = true;
    mocked.rpc.mockReturnValue(Promise.resolve({ data: null, error: new Error('offline') }));

    renderHook(() => useNotificationRouting());
    await tapNotification({ route: '/order/chat', order_id: 'order-1' });

    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('pending destination across login', () => {
  it('does not navigate before an account exists', async () => {
    allowAccess();
    renderHook(() => useNotificationRouting());

    await tapNotification({ route: '/order/chat', order_id: 'order-1' });

    expect(mockPush).not.toHaveBeenCalled();
    expect(peekPendingDestination()).toEqual({ route: '/order/chat', orderId: 'order-1' });
  });

  it('does not navigate while restoration is unresolved', async () => {
    mockAuthState.user = { id: 'user-a' };
    mockSessionState.isRestored = false;
    allowAccess();

    renderHook(() => useNotificationRouting());
    await tapNotification({ route: '/order/chat', order_id: 'order-1' });

    expect(mockPush).not.toHaveBeenCalled();
    expect(peekPendingDestination()).not.toBeNull();
  });

  it('opens the held destination once the account restores', async () => {
    allowAccess();
    const view = renderHook(() => useNotificationRouting());

    await tapNotification({ route: '/order/chat', order_id: 'order-1' });
    expect(mockPush).not.toHaveBeenCalled();

    mockAuthState.user = { id: 'user-a' };
    mockSessionState.isRestored = true;
    await act(async () => {
      view.rerender(undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(peekPendingDestination()).toBeNull();
  });

  it('rechecks authorisation before opening a held destination', async () => {
    denyAccess();
    const view = renderHook(() => useNotificationRouting());

    await tapNotification({ route: '/order/chat', order_id: 'order-1' });

    mockAuthState.user = { id: 'user-b' };
    mockSessionState.isRestored = true;
    await act(async () => {
      view.rerender(undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(mocked.rpc).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('never opens a conversation a reassigned courier lost', async () => {
    denyAccess();
    mockAuthState.user = { id: 'former-courier' };
    mockSessionState.isRestored = true;

    renderHook(() => useNotificationRouting());
    await tapNotification({ route: '/order/chat', order_id: 'order-1' });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('consumes a held destination only once', async () => {
    allowAccess();
    setPendingDestination({ route: '/order/chat', orderId: 'order-1' });

    mockAuthState.user = { id: 'user-a' };
    mockSessionState.isRestored = true;

    const view = renderHook(() => useNotificationRouting());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));

    await act(async () => {
      view.rerender(undefined);
      await Promise.resolve();
    });

    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe('support ticket deep links', () => {
  const ticketData = {
    route: '/order/support-ticket',
    order_id: 'order-1',
    ticket_id: 'ticket-1',
  };

  it.each([
    [{ route: '/order/support-ticket', order_id: 'order-1' }],
    [{ route: '/order/support-ticket', ticket_id: 'ticket-1' }],
    [{ route: '/order/support-ticket', order_id: 'order-1', ticket_id: 7 }],
  ])('never builds a support destination from %p', (data) => {
    expect(destinationFromNotificationData(data as never)).toBeNull();
  });

  it('carries the ticket a support notification points at', () => {
    expect(destinationFromNotificationData(ticketData)).toEqual({
      route: '/order/support-ticket',
      orderId: 'order-1',
      ticketId: 'ticket-1',
    });
  });

  it('opens a ticket the account may read', async () => {
    mockAuthState.user = { id: 'user-a' };
    mockSessionState.isRestored = true;
    mocked.rpc.mockReturnValue(
      Promise.resolve({ data: [{ id: 'ticket-1', viewer_role: 'customer' }], error: null })
    );

    renderHook(() => useNotificationRouting());
    await tapNotification(ticketData);

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/order/support-ticket',
        params: { id: 'ticket-1' },
      })
    );
    expect(mocked.rpc).toHaveBeenCalledWith('support_ticket_details', {
      p_ticket_id: 'ticket-1',
    });
  });

  it('refuses to open a ticket that belongs to another account', async () => {
    mockAuthState.user = { id: 'user-b' };
    mockSessionState.isRestored = true;
    mocked.rpc.mockReturnValue(
      Promise.resolve({ data: null, error: { message: 'You cannot read this ticket' } })
    );

    renderHook(() => useNotificationRouting());
    await tapNotification(ticketData);

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('refuses to open a ticket the server will not return', async () => {
    mockAuthState.user = { id: 'user-b' };
    mockSessionState.isRestored = true;
    mocked.rpc.mockReturnValue(Promise.resolve({ data: [], error: null }));

    renderHook(() => useNotificationRouting());
    await tapNotification(ticketData);

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('holds a support tap until the session is restored', async () => {
    mockAuthState.user = null;
    mockSessionState.isRestored = false;

    renderHook(() => useNotificationRouting());
    await tapNotification(ticketData);

    expect(mockPush).not.toHaveBeenCalled();
    expect(mocked.rpc).not.toHaveBeenCalled();
    expect(peekPendingDestination()).toEqual({
      route: '/order/support-ticket',
      orderId: 'order-1',
      ticketId: 'ticket-1',
    });
  });

  it('checks authorisation again before opening a held support tap', async () => {
    setPendingDestination({
      route: '/order/support-ticket',
      orderId: 'order-1',
      ticketId: 'ticket-1',
    });
    mocked.rpc.mockReturnValue(
      Promise.resolve({ data: null, error: { message: 'You cannot read this ticket' } })
    );

    mockAuthState.user = { id: 'user-b' };
    mockSessionState.isRestored = true;

    renderHook(() => useNotificationRouting());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(mocked.rpc).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('keeps chat and support taps on their own screens', async () => {
    mockAuthState.user = { id: 'user-a' };
    mockSessionState.isRestored = true;
    mocked.rpc.mockReturnValue(
      Promise.resolve({ data: [{ can_read: true, id: 'ticket-1' }], error: null })
    );

    renderHook(() => useNotificationRouting());
    await tapNotification({ route: '/order/chat', order_id: 'order-1' });
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));

    await tapNotification(ticketData);
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(2));

    expect(mockPush).toHaveBeenNthCalledWith(1, {
      pathname: '/order/chat',
      params: { id: 'order-1' },
    });
    expect(mockPush).toHaveBeenNthCalledWith(2, {
      pathname: '/order/support-ticket',
      params: { id: 'ticket-1' },
    });
  });
});
