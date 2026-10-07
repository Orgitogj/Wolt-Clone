import { useAddressSelectionStore } from '@/hooks/use-address-store';
import { useCartStore } from '@/hooks/use-cartstore';
import { useScheduleStore } from '@/hooks/use-schedule-store';
import { useSessionStore } from '@/hooks/use-session-store';

type PersistedStore = {
  persist: {
    hasHydrated: () => boolean;
    onFinishHydration: (listener: () => void) => () => void;
  };
};

const persistedStores = (): PersistedStore[] => [
  useCartStore as unknown as PersistedStore,
  useAddressSelectionStore as unknown as PersistedStore,
  useScheduleStore as unknown as PersistedStore,
  useSessionStore as unknown as PersistedStore,
];

export const allStoresHydrated = (): boolean =>
  persistedStores().every((store) => store.persist.hasHydrated());

export const whenStoresHydrated = (listener: () => void): (() => void) => {
  if (allStoresHydrated()) {
    listener();
    return () => undefined;
  }

  const unsubscribers = persistedStores().map((store) =>
    store.persist.onFinishHydration(() => {
      if (allStoresHydrated()) listener();
    })
  );

  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
};
