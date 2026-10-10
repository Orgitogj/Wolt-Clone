jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

const mockAuthState: { user: { id: string; is_anonymous?: boolean } | null; isLoading: boolean } = {
  user: null,
  isLoading: true,
};

jest.mock('@/hooks/use-auth-store', () => {
  const actual = jest.requireActual('@/hooks/use-auth-store');
  const useAuthStore = (selector: (state: typeof mockAuthState) => unknown) =>
    selector(mockAuthState);
  return {
    __esModule: true,
    default: useAuthStore,
    markCartCarryOver: actual.markCartCarryOver,
    consumeCartCarryOver: actual.consumeCartCarryOver,
    clearCartCarryOver: actual.clearCartCarryOver,
  };
});

const mockHydration = { ready: true };

jest.mock('@/utils/storeHydration', () => ({
  allStoresHydrated: () => mockHydration.ready,
  whenStoresHydrated: (listener: () => void) => {
    if (mockHydration.ready) listener();
    return () => undefined;
  },
}));

const mockClearStoredSession = jest.fn(() => Promise.resolve());

jest.mock('@/lib/secureSessionStorage', () => ({
  clearStoredSession: () => mockClearStoredSession(),
}));

import { useSessionIsolation } from '@/hooks/useSessionIsolation';
import { resetSessionEpochForTests } from '@/utils/sessionGuard';
import { resetUserScopedState } from '@/utils/sessionReset';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  resetSessionEpochForTests();
  mockAuthState.user = null;
  mockAuthState.isLoading = false;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('resetUserScopedState', () => {
  it('clears the stored session when the account signed out', async () => {
    await resetUserScopedState(queryClient, { preserveCart: false, signedOut: true });

    expect(mockClearStoredSession).toHaveBeenCalledTimes(1);
  });

  it('keeps the stored session when another account signed in', async () => {
    await resetUserScopedState(queryClient, { preserveCart: false, signedOut: false });

    expect(mockClearStoredSession).not.toHaveBeenCalled();
  });

  it('keeps the stored session by default', async () => {
    await resetUserScopedState(queryClient, { preserveCart: true });

    expect(mockClearStoredSession).not.toHaveBeenCalled();
  });
});

describe('signing out of the app', () => {
  it('never deletes the session it has just signed in with', async () => {
    mockAuthState.user = { id: 'user-a' };

    renderHook(() => useSessionIsolation(), { wrapper });
    await flush();

    expect(mockClearStoredSession).not.toHaveBeenCalled();
  });

  it('deletes the stored session once the account is gone', async () => {
    mockAuthState.user = { id: 'user-a' };

    const { rerender } = renderHook(() => useSessionIsolation(), { wrapper });
    await flush();

    mockAuthState.user = null;
    rerender(undefined);
    await flush();

    await waitFor(() => expect(mockClearStoredSession).toHaveBeenCalledTimes(1));
  });

  it('keeps the stored session when switching straight to another account', async () => {
    mockAuthState.user = { id: 'user-a' };

    const { rerender } = renderHook(() => useSessionIsolation(), { wrapper });
    await flush();

    mockAuthState.user = { id: 'user-b' };
    rerender(undefined);
    await flush();

    expect(mockClearStoredSession).not.toHaveBeenCalled();
  });
});
