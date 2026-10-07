jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

import useAuthStore, {
  clearCartCarryOver,
  consumeCartCarryOver,
  markCartCarryOver,
} from '@/hooks/use-auth-store';
import { supabase } from '@/lib/supabase';
import type { SupabaseMock } from './helpers/supabase';

const mocked = supabase as unknown as SupabaseMock;

const asGuest = () => {
  useAuthStore.setState({
    user: { id: 'anon-user', is_anonymous: true } as never,
    isAnonymous: true,
    isLoading: false,
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  clearCartCarryOver();
  useAuthStore.setState({ user: null, isAnonymous: false, isLoading: false });
  mocked.auth.signUp.mockResolvedValue({ data: { session: {} }, error: null });
  mocked.auth.signInWithPassword.mockResolvedValue({ error: null });
  mocked.auth.signInWithOAuth.mockResolvedValue({ error: null });
  mocked.auth.signInAnonymously.mockResolvedValue({ error: null });
  mocked.auth.signOut.mockResolvedValue({ error: null });
});

describe('marking the intent', () => {
  it('marks a carry over when a guest signs up', async () => {
    asGuest();

    await useAuthStore.getState().signUpWithEmail('new@example.com', 'secret');

    expect(consumeCartCarryOver('anon-user')).toBe(true);
  });

  it('does not mark a carry over when a signed in user signs up', async () => {
    useAuthStore.setState({
      user: { id: 'user-a', is_anonymous: false } as never,
      isAnonymous: false,
    });

    await useAuthStore.getState().signUpWithEmail('new@example.com', 'secret');

    expect(consumeCartCarryOver('user-a')).toBe(false);
  });

  it('drops the intent when the sign up fails', async () => {
    asGuest();
    mocked.auth.signUp.mockResolvedValue({ data: {}, error: { message: 'Email taken' } });

    const result = await useAuthStore.getState().signUpWithEmail('taken@example.com', 'secret');

    expect(result.error).toBe('Email taken');
    expect(consumeCartCarryOver('anon-user')).toBe(false);
  });
});

describe('clearing the intent', () => {
  it('clears it when signing into an existing account with a password', async () => {
    asGuest();
    markCartCarryOver('anon-user');

    await useAuthStore.getState().signInWithEmail('other@example.com', 'secret');

    expect(consumeCartCarryOver('anon-user')).toBe(false);
  });

  it('clears it when signing in through a provider', async () => {
    asGuest();
    markCartCarryOver('anon-user');

    await useAuthStore.getState().signInWithOAuth('google');

    expect(consumeCartCarryOver('anon-user')).toBe(false);
  });

  it('clears it when starting a new guest session', async () => {
    markCartCarryOver('anon-user');

    await useAuthStore.getState().signInAnonymously();

    expect(consumeCartCarryOver('anon-user')).toBe(false);
  });

  it('clears it on sign out', async () => {
    markCartCarryOver('anon-user');

    await useAuthStore.getState().signOut();

    expect(consumeCartCarryOver('anon-user')).toBe(false);
  });
});

describe('expiry', () => {
  it('honours an intent inside the window', () => {
    markCartCarryOver('anon-user', 1_000_000);

    expect(consumeCartCarryOver('anon-user', 1_000_000 + 60_000)).toBe(true);
  });

  it('ignores an intent once the window has passed', () => {
    markCartCarryOver('anon-user', 1_000_000);

    expect(consumeCartCarryOver('anon-user', 1_000_000 + 16 * 60 * 1000)).toBe(false);
  });

  it('is single use', () => {
    markCartCarryOver('anon-user');

    expect(consumeCartCarryOver('anon-user')).toBe(true);
    expect(consumeCartCarryOver('anon-user')).toBe(false);
  });
});

describe('sign out reporting', () => {
  it('reports a sign out failure instead of swallowing it', async () => {
    mocked.auth.signOut.mockResolvedValue({
      error: { message: 'Network request failed' },
    } as never);

    const result = await useAuthStore.getState().signOut();

    expect(result.error).toBe('Network request failed');
  });

  it('reports success as no error', async () => {
    const result = await useAuthStore.getState().signOut();

    expect(result.error).toBeNull();
  });
});
