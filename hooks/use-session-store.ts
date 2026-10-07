import zustandStorage from '@/utils/zustandStorage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface SessionState {
  ownerKey: string | null;
  isRestored: boolean;
  epoch: number;
  setOwnerKey: (ownerKey: string | null) => void;
  setRestored: (isRestored: boolean) => void;
  setEpoch: (epoch: number) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      ownerKey: null,
      isRestored: false,
      epoch: 0,
      setOwnerKey: (ownerKey) => set({ ownerKey }),
      setRestored: (isRestored) => set({ isRestored }),
      setEpoch: (epoch) => set({ epoch }),
    }),
    {
      name: 'session-owner',
      storage: createJSONStorage(() => zustandStorage),
      partialize: (state) => ({ ownerKey: state.ownerKey }),
    }
  )
);

export const useIsSessionRestored = () => useSessionStore((state) => state.isRestored);

export const useSessionEpoch = () => useSessionStore((state) => state.epoch);
