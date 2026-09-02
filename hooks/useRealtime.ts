import { supabase } from '@/lib/supabase';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

type ChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export interface RealtimeSubscription {
  channel: string;
  table: string;
  event?: ChangeEvent;
  filter?: string;
  enabled?: boolean;
  invalidate?: unknown[][];
  onChange?: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
}

export const useRealtimeTable = ({
  channel,
  table,
  event = '*',
  filter,
  enabled = true,
  invalidate,
  onChange,
}: RealtimeSubscription) => {
  const queryClient = useQueryClient();
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

  const invalidateKey = JSON.stringify(invalidate ?? []);

  useEffect(() => {
    if (!enabled) return;

    const subscription = supabase
      .channel(channel)
      .on(
        'postgres_changes',
        { event, schema: 'public', table, ...(filter ? { filter } : {}) },
        (payload) => {
          handlerRef.current?.(payload);
          (JSON.parse(invalidateKey) as unknown[][]).forEach((queryKey) => {
            queryClient.invalidateQueries({ queryKey });
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [channel, table, event, filter, enabled, invalidateKey, queryClient]);
};
