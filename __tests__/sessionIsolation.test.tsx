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

const mockHydration = { ready: false, listener: null as null | (() => void) };

jest.mock('@/utils/storeHydration', () => ({
  allStoresHydrated: () => mockHydration.ready,
  whenStoresHydrated: (listener: () => void) => {
    mockHydration.listener = listener;
    if (mockHydration.ready) listener();
    return () => {
      mockHydration.listener = null;
    };
  },
}));

import { clearCartCarryOver, markCartCarryOver } from '@/hooks/use-auth-store';
import { useCartStore } from '@/hooks/use-cartstore';
import { useSessionStore } from '@/hooks/use-session-store';
import { useSessionIsolation } from '@/hooks/useSessionIsolation';
import type { Dish, Restaurant } from '@/types/database';
import {
  currentSessionEpoch,
  isStaleSession,
  resetSessionEpochForTests,
} from '@/utils/sessionGuard';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

const dish = { id: 'dish-1', price: 10 } as Dish;
const restaurant = { id: 'restaurant-1', name: 'Pizza Place' } as unknown as Restaurant;

const GUEST = { id: 'anon-user', is_anonymous: true };
const GUEST_UPGRADED = { id: 'anon-user', is_anonymous: false };
const USER_A = { id: 'user-a', is_anonymous: false };
const USER_B = { id: 'user-b', is_anonymous: false };

const keyFor = (user: { id: string; is_anonymous?: boolean }) =>
  `${user.id}:${user.is_anonymous ? 'guest' : 'registered'}`;

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const seedCart = () => {
  useCartStore.getState().setSelectedRestaurant(restaurant);
  useCartStore.getState().addItem(dish, 1);
};

const setAuth = (user: typeof USER_A | null, isLoading = false) => {
  mockAuthState.user = user;
  mockAuthState.isLoading = isLoading;
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const mount = () => renderHook(() => useSessionIsolation(), { wrapper });

const hydrate = async () => {
  mockHydration.ready = true;
  await act(async () => {
    mockHydration.listener?.();
    await Promise.resolve();
  });
  await flush();
};

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  useCartStore.getState().clearCart();
  useSessionStore.setState({ ownerKey: null, isRestored: false, epoch: 0 });
  mockHydration.ready = false;
  mockHydration.listener = null;
  clearCartCarryOver();
  resetSessionEpochForTests();
  setAuth(null, true);
});

describe('cold start', () => {
  it('keeps a basket that belongs to the restored account', async () => {
    seedCart();
    useSessionStore.setState({ ownerKey: keyFor(USER_A) });
    setAuth(USER_A);

    mount();
    await hydrate();

    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useSessionStore.getState().isRestored).toBe(true);
  });

  it('clears a basket left by another account when a different session is restored', async () => {
    seedCart();
    useSessionStore.setState({ ownerKey: keyFor(USER_A) });
    setAuth(USER_B);

    mount();
    await hydrate();

    expect(useCartStore.getState().items).toHaveLength(0);
    expect(useSessionStore.getState().ownerKey).toBe(keyFor(USER_B));
  });

  it('clears a basket left behind when the session is missing or expired', async () => {
    seedCart();
    useSessionStore.setState({ ownerKey: keyFor(USER_A) });
    setAuth(null);

    mount();
    await hydrate();

    expect(useCartStore.getState().items).toHaveLength(0);
    expect(useSessionStore.getState().ownerKey).toBeNull();
  });

  it('does not expose a basket before restoration resolves', () => {
    seedCart();
    useSessionStore.setState({ ownerKey: keyFor(USER_A) });
    setAuth(USER_B);

    mount();

    expect(useSessionStore.getState().isRestored).toBe(false);
  });
});

describe('late hydration', () => {
  it('does not let storage rehydration reappear after the account resolved', async () => {
    useSessionStore.setState({ ownerKey: keyFor(USER_A) });
    setAuth(USER_B);

    mount();
    await flush();

    seedCart();
    await hydrate();

    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('waits for hydration before deciding anything', async () => {
    seedCart();
    useSessionStore.setState({ ownerKey: keyFor(USER_A) });
    setAuth(USER_A);

    mount();
    await flush();

    expect(useSessionStore.getState().isRestored).toBe(false);

    await hydrate();

    expect(useSessionStore.getState().isRestored).toBe(true);
    expect(useCartStore.getState().items).toHaveLength(1);
  });
});

describe('account transitions', () => {
  it('clears everything when switching from one account to another', async () => {
    useSessionStore.setState({ ownerKey: keyFor(USER_A) });
    setAuth(USER_A);
    const view = mount();
    await hydrate();

    seedCart();
    queryClient.setQueryData(['profile', 'user-a'], { full_name: 'Ada' });

    setAuth(USER_B);
    view.rerender(undefined);
    await flush();

    expect(useCartStore.getState().items).toHaveLength(0);
    expect(queryClient.getQueryData(['profile', 'user-a'])).toBeUndefined();
    expect(useSessionStore.getState().ownerKey).toBe(keyFor(USER_B));
  });

  it('clears on sign out', async () => {
    useSessionStore.setState({ ownerKey: keyFor(USER_A) });
    setAuth(USER_A);
    const view = mount();
    await hydrate();
    seedCart();

    setAuth(null);
    view.rerender(undefined);
    await flush();

    expect(useCartStore.getState().items).toHaveLength(0);
    expect(useSessionStore.getState().ownerKey).toBeNull();
  });

  it('settles on the final account after rapid successive transitions', async () => {
    useSessionStore.setState({ ownerKey: keyFor(USER_A) });
    setAuth(USER_A);
    const view = mount();
    await hydrate();
    seedCart();

    setAuth(USER_B);
    view.rerender(undefined);
    setAuth(null);
    view.rerender(undefined);
    setAuth(USER_A);
    view.rerender(undefined);
    await flush();

    expect(useSessionStore.getState().ownerKey).toBe(keyFor(USER_A));
    expect(useCartStore.getState().items).toHaveLength(0);
  });
});

describe('guest upgrade', () => {
  it('detects the upgrade even though the user id never changes', async () => {
    useSessionStore.setState({ ownerKey: keyFor(GUEST) });
    setAuth(GUEST);
    const view = mount();
    await hydrate();
    seedCart();
    queryClient.setQueryData(['profile', 'anon-user'], { full_name: 'Guest' });

    markCartCarryOver('anon-user');
    setAuth(GUEST_UPGRADED);
    view.rerender(undefined);
    await flush();

    expect(useSessionStore.getState().ownerKey).toBe(keyFor(GUEST_UPGRADED));
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(queryClient.getQueryData(['profile', 'anon-user'])).toBeUndefined();
  });

  it('clears the basket when the same id upgrade was never requested', async () => {
    useSessionStore.setState({ ownerKey: keyFor(GUEST) });
    setAuth(GUEST);
    const view = mount();
    await hydrate();
    seedCart();

    setAuth(GUEST_UPGRADED);
    view.rerender(undefined);
    await flush();

    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('drops a guest basket when the guest signs into a different account', async () => {
    useSessionStore.setState({ ownerKey: keyFor(GUEST) });
    setAuth(GUEST);
    const view = mount();
    await hydrate();
    seedCart();

    markCartCarryOver('anon-user');
    clearCartCarryOver();
    setAuth(USER_A);
    view.rerender(undefined);
    await flush();

    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('ignores an abandoned upgrade intent once it has expired', async () => {
    useSessionStore.setState({ ownerKey: keyFor(GUEST) });
    setAuth(GUEST);
    const view = mount();
    await hydrate();
    seedCart();

    markCartCarryOver('anon-user', Date.now() - 60 * 60 * 1000);
    setAuth(GUEST_UPGRADED);
    view.rerender(undefined);
    await flush();

    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('never carries a basket across an app restart', async () => {
    markCartCarryOver('anon-user');
    seedCart();
    useSessionStore.setState({ ownerKey: keyFor(GUEST) });
    setAuth(USER_A);

    mount();
    await hydrate();

    expect(useCartStore.getState().items).toHaveLength(0);
  });
});

describe('late responses', () => {
  it('bumps the session epoch on every account change', async () => {
    useSessionStore.setState({ ownerKey: keyFor(USER_A) });
    setAuth(USER_A);
    const view = mount();
    await hydrate();

    const before = currentSessionEpoch();
    setAuth(USER_B);
    view.rerender(undefined);
    await flush();

    expect(currentSessionEpoch()).toBeGreaterThan(before);
  });

  it('marks work captured before a switch as stale', async () => {
    useSessionStore.setState({ ownerKey: keyFor(USER_A) });
    setAuth(USER_A);
    const view = mount();
    await hydrate();

    const captured = currentSessionEpoch();
    expect(isStaleSession(captured)).toBe(false);

    setAuth(USER_B);
    view.rerender(undefined);
    await flush();

    expect(isStaleSession(captured)).toBe(true);
  });

  it('does not bump the epoch when the account is unchanged', async () => {
    useSessionStore.setState({ ownerKey: keyFor(USER_A) });
    setAuth(USER_A);
    const view = mount();
    await hydrate();

    const before = currentSessionEpoch();
    view.rerender(undefined);
    await flush();

    expect(currentSessionEpoch()).toBe(before);
  });

  it('cancels in flight queries so a slow response cannot land in the next account', async () => {
    useSessionStore.setState({ ownerKey: keyFor(USER_A) });
    setAuth(USER_A);
    const view = mount();
    await hydrate();

    const cancelSpy = jest.spyOn(queryClient, 'cancelQueries');
    setAuth(USER_B);
    view.rerender(undefined);
    await flush();

    expect(cancelSpy).toHaveBeenCalled();
  });
});
