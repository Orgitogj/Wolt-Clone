import zustandStorage from '@/utils/zustandStorage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface ScheduledTime {
  day: string;
  time: string;
}

interface ScheduleStore {
  selectedSchedule: ScheduledTime | null;
  setSelectedSchedule: (schedule: ScheduledTime | null) => void;
}

export const useScheduleStore = create<ScheduleStore>()(
  persist(
    (set) => ({
      selectedSchedule: null,
      setSelectedSchedule: (schedule) => set({ selectedSchedule: schedule }),
    }),
    {
      name: 'selected-schedule',
      storage: createJSONStorage(() => zustandStorage),
    }
  )
);
