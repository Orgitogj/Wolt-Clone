import { supabase } from '@/lib/supabase';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

type ChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export type RealtimeConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected';

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
}: RealtimeSubscription): RealtimeConnectionState => {
  const queryClient = useQueryClient();
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

  const [connection, setConnection] = useState<RealtimeConnectionState>('idle');
  const invalidateKey = JSON.stringify(invalidate ?? []);

  useEffect(() => {
    if (!enabled) {
      setConnection('idle');
      return;
    }

    setConnection('connecting');

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
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnection('connected');
          (JSON.parse(invalidateKey) as unknown[][]).forEach((queryKey) => {
            queryClient.invalidateQueries({ queryKey });
          });
          return;
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnection('disconnected');
        }
      });

    return () => {
      setConnection('idle');
      supabase.removeChannel(subscription);
    };
  }, [channel, table, event, filter, enabled, invalidateKey, queryClient]);

  return connection;
};

export const useAppForeground = (onForeground: () => void, enabled = true) => {
  const handlerRef = useRef(onForeground);
  handlerRef.current = onForeground;

  useEffect(() => {
    if (!enabled) return;

    let previous: AppStateStatus = AppState.currentState;

    const subscription = AppState.addEventListener('change', (next) => {
      if (previous.match(/inactive|background/) && next === 'active') {
        handlerRef.current();
      }
      previous = next;
    });

    return () => subscription.remove();
  }, [enabled]);
};

export const usePollingFallback = (
  onPoll: () => void,
  { enabled, intervalMs = 15000, maxPolls = 40 }: {
    enabled: boolean;
    intervalMs?: number;
    maxPolls?: number;
  }
) => {
  const handlerRef = useRef(onPoll);
  handlerRef.current = onPoll;

  const [pollCount, setPollCount] = useState(0);

  const reset = useCallback(() => setPollCount(0), []);

  useEffect(() => {
    if (!enabled) return;
    setPollCount(0);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || pollCount >= maxPolls) return;

    const timer = setTimeout(() => {
      handlerRef.current();
      setPollCount((count) => count + 1);
    }, intervalMs);

    return () => clearTimeout(timer);
  }, [enabled, pollCount, intervalMs, maxPolls]);

  return { pollCount, isExhausted: pollCount >= maxPolls, reset };
};
