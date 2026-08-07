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
  signOut: () => Promise<void>;
}

const useAuthStore = create<AuthState>((set) => {
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
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    },

    signUpWithEmail: async (email, password, fullName) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Without this the confirmation email points at the project's Site URL,
          // which defaults to http://localhost:3000 and is useless on a phone.
          emailRedirectTo: Linking.createURL('/'),
          ...(fullName ? { data: { full_name: fullName } } : {}),
        },
      });
      // When "Confirm email" is enabled in the Supabase project (the default),
      // signUp succeeds but returns no session until the user clicks the email link.
      const needsEmailConfirmation = !error && !data.session;
      return { error: error?.message ?? null, needsEmailConfirmation };
    },

    signInAnonymously: async () => {
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
      const { error } = await supabase.auth.signInWithOAuth({ provider });
      return { error: error?.message ?? null };
    },

    signOut: async () => {
      await supabase.auth.signOut();
    },
  };
});

export default useAuthStore;
