import { supabase } from '@/lib/supabase';
import type { AdminReconciliation } from '@/types/database';

export const RECONCILIATION_PAGE_SIZE = 20;

export interface ReconciliationPage {
  reconciliations: AdminReconciliation[];
  nextOffset: number | null;
}

export const reconciliationService = {
  list: async (offset = 0, limit = RECONCILIATION_PAGE_SIZE): Promise<ReconciliationPage> => {
    const { data, error } = await supabase.rpc('admin_payment_reconciliations', {
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw error;

    const reconciliations = (data ?? []) as AdminReconciliation[];
    return {
      reconciliations,
      nextOffset: reconciliations.length < limit ? null : offset + reconciliations.length,
    };
  },

  retry: async (id: string, reason: string): Promise<AdminReconciliation> => {
    const { data, error } = await supabase.rpc('admin_retry_payment_reconciliation', {
      p_id: id,
      p_reason: reason,
    });
    if (error) throw error;
    return data as AdminReconciliation;
  },
};

export const RECONCILIATION_STATE_LABELS: Record<string, string> = {
  pending: 'Waiting to retry',
  in_progress: 'Worker running',
  resolved: 'Refunded',
  abandoned: 'Needs attention',
};

export const canRetryReconciliation = (item: AdminReconciliation): boolean =>
  item.state !== 'resolved' && !item.lease_active;
