import type { User } from '@supabase/supabase-js';

export interface AccountIdentity {
  userId: string;
  isAnonymous: boolean;
}

export const accountIdentityOf = (user: User | null | undefined): AccountIdentity | null =>
  user ? { userId: user.id, isAnonymous: !!user.is_anonymous } : null;

export const accountKeyOf = (identity: AccountIdentity | null): string | null =>
  identity ? `${identity.userId}:${identity.isAnonymous ? 'guest' : 'registered'}` : null;

export const accountIdOfKey = (key: string | null): string | null =>
  key ? key.slice(0, key.lastIndexOf(':')) : null;

export const isGuestKey = (key: string | null): boolean => !!key && key.endsWith(':guest');
