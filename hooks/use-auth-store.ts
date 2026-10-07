import { supabase } from '@/lib/supabase';
import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { create } from 'zustand';

interface AuthState {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isAnonymous: boolean;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithEmail: (
    email: string,
    password: string,
    fullName?: string
  ) => Promise<{ error: string | null; needsEmailConfirmation: boolean }>;
  signInAnonymously: () => Promise<{ error: string | null }>;
  signInWithOAuth: (provider: 'apple' | 'google' | 'facebook') => Promise<{ error: string | null }>;
  signOut: () => Promise<{ error: string | null }>;
}

const CARRY_OVER_TTL_MS = 15 * 60 * 1000;

let cartCarryOver: { userId: string; expiresAt: number } | null = null;

export const markCartCarryOver = (anonymousUserId: string, now = Date.now()) => {
  cartCarryOver = { userId: anonymousUserId, expiresAt: now + CARRY_OVER_TTL_MS };
};

export const clearCartCarryOver = () => {
  cartCarryOver = null;
};

export const consumeCartCarryOver = (previousUserId: string | null, now = Date.now()): boolean => {
  const pending = cartCarryOver;
  cartCarryOver = null;

  if (!pending || !previousUserId) return false;
  if (pending.expiresAt <= now) return false;
  return pending.userId === previousUserId;
};

const useAuthStore = create<AuthState>((set, get) => {
  supabase.auth.getSession().then(({ data }) => {
    set({
      session: data.session,
      user: data.session?.user ?? null,
      isAnonymous: !!data.session?.user?.is_anonymous,
      isLoading: false,
    });
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    set({
      session,
      user: session?.user ?? null,
      isAnonymous: !!session?.user?.is_anonymous,
      isLoading: false,
    });
  });

  return {
    session: null,
    user: null,
    isLoading: true,
    isAnonymous: false,

    signInWithEmail: async (email, password) => {
      clearCartCarryOver();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    },

    signUpWithEmail: async (email, password, fullName) => {
      const { user, isAnonymous } = get();
      if (isAnonymous && user) {
        markCartCarryOver(user.id);
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {

          emailRedirectTo: Linking.createURL('/'),
          ...(fullName ? { data: { full_name: fullName } } : {}),
        },
      });

      if (error) {
        consumeCartCarryOver(user?.id ?? null);
      }

      const needsEmailConfirmation = !error && !data.session;
      return { error: error?.message ?? null, needsEmailConfirmation };
    },

    signInAnonymously: async () => {
      clearCartCarryOver();
      const { error } = await supabase.auth.signInAnonymously();
      if (error && /disabled|not enabled/i.test(error.message)) {
        return {
          error:
            'Guest sign-in is turned off for this Supabase project. Enable it in the dashboard under Authentication → Sign In / Providers → Anonymous sign-ins.',
        };
      }
      return { error: error?.message ?? null };
    },

    signInWithOAuth: async (provider) => {
      clearCartCarryOver();
      const { error } = await supabase.auth.signInWithOAuth({ provider });
      return { error: error?.message ?? null };
    },

    signOut: async () => {
      clearCartCarryOver();
      const { error } = await supabase.auth.signOut();
      return { error: error?.message ?? null };
    },
  };
});

export default useAuthStore;
