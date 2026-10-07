import useAuthStore, { consumeCartCarryOver } from '@/hooks/use-auth-store';
import { useSessionStore } from '@/hooks/use-session-store';
import { accountIdOfKey, accountIdentityOf, accountKeyOf } from '@/utils/accountIdentity';
import { bumpSessionEpoch } from '@/utils/sessionGuard';
import { resetUserScopedState } from '@/utils/sessionReset';
import { whenStoresHydrated } from '@/utils/storeHydration';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

export const useSessionIsolation = () => {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isLoading = useAuthStore((state) => state.isLoading);
  const [isHydrated, setIsHydrated] = useState(false);
  const previousKey = useRef<string | null | undefined>(undefined);
  const pending = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => whenStoresHydrated(() => setIsHydrated(true)), []);

  const accountKey = accountKeyOf(accountIdentityOf(user));

  useEffect(() => {
    if (isLoading || !isHydrated) return;

    const previous = previousKey.current;
    previousKey.current = accountKey;

    const storedOwnerKey = useSessionStore.getState().ownerKey;
    const comparisonKey = previous === undefined ? storedOwnerKey : previous;

    if (previous !== undefined && previous === accountKey) {
      useSessionStore.getState().setRestored(true);
      return;
    }

    if (previous === undefined && storedOwnerKey === accountKey) {
      useSessionStore.getState().setRestored(true);
      return;
    }

    const preserveCart =
      previous !== undefined && consumeCartCarryOver(accountIdOfKey(comparisonKey));

    const epoch = bumpSessionEpoch();
    useSessionStore.getState().setRestored(false);

    pending.current = pending.current
      .then(() => resetUserScopedState(queryClient, { preserveCart }))
      .then(() => {
        useSessionStore.getState().setOwnerKey(accountKey);
        useSessionStore.getState().setEpoch(epoch);
        if (previousKey.current === accountKey) {
          useSessionStore.getState().setRestored(true);
        }
      })
      .catch(() => undefined);
  }, [accountKey, isLoading, isHydrated, queryClient]);
};
