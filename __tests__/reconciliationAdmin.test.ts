jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

import { supabase } from '@/lib/supabase';
import {
  RECONCILIATION_STATE_LABELS,
  canRetryReconciliation,
  reconciliationService,
} from '@/services/reconciliationService';
import type { AdminReconciliation } from '@/types/database';
import type { SupabaseMock } from './helpers/supabase';

const mocked = supabase as unknown as SupabaseMock;

const rpcResult = (data: unknown) => Promise.resolve({ data, error: null });

const record = (overrides: Partial<AdminReconciliation> = {}): AdminReconciliation => ({
  id: 'rec-1',
  order_id: 'order-1',
  payment_id: 'pay-1',
  provider_intent_id: 'pi_1',
  amount: 23.5,
  currency: 'EUR',
  state: 'pending',
  attempts: 3,
  last_error: 'Stripe timed out',
  last_attempt_at: '2026-01-01T10:00:00.000Z',
  next_attempt_at: '2026-01-01T10:05:00.000Z',
  lease_active: false,
  provider_status: null,
  resolved_at: null,
  created_at: '2026-01-01T09:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listing', () => {
  it('reads the admin queue through the server function', async () => {
    mocked.rpc.mockReturnValue(rpcResult([record()]));

    await reconciliationService.list();

    expect(mocked.rpc).toHaveBeenCalledWith('admin_payment_reconciliations', {
      p_limit: 20,
      p_offset: 0,
    });
  });

  it('pages a full result', async () => {
    mocked.rpc.mockReturnValue(rpcResult(Array.from({ length: 20 }, () => record())));

    const page = await reconciliationService.list(0);

    expect(page.nextOffset).toBe(20);
  });

  it('stops paging on a short page', async () => {
    mocked.rpc.mockReturnValue(rpcResult([record()]));

    expect((await reconciliationService.list(20)).nextOffset).toBeNull();
  });

  it('never reads the reconciliation table directly', async () => {
    mocked.rpc.mockReturnValue(rpcResult([]));

    await reconciliationService.list();

    expect(mocked.from).not.toHaveBeenCalled();
  });

  it('surfaces a refused list instead of showing an empty queue', async () => {
    mocked.rpc.mockReturnValue(
      Promise.resolve({ data: null, error: new Error('Administrator access is required') })
    );

    await expect(reconciliationService.list()).rejects.toThrow('Administrator access is required');
  });
});

describe('retry eligibility', () => {
  it('allows retrying a pending record', () => {
    expect(canRetryReconciliation(record())).toBe(true);
  });

  it('allows retrying an abandoned record so captured money stays actionable', () => {
    expect(canRetryReconciliation(record({ state: 'abandoned', attempts: 10 }))).toBe(true);
  });

  it('never offers retry on a resolved refund', () => {
    expect(canRetryReconciliation(record({ state: 'resolved' }))).toBe(false);
  });

  it('never offers retry while a worker holds the lease', () => {
    expect(canRetryReconciliation(record({ state: 'in_progress', lease_active: true }))).toBe(false);
  });

  it('offers retry once a stale lease expired', () => {
    expect(canRetryReconciliation(record({ state: 'in_progress', lease_active: false }))).toBe(true);
  });

  it('has a human label for every state', () => {
    (['pending', 'in_progress', 'resolved', 'abandoned'] as const).forEach((state) => {
      expect(RECONCILIATION_STATE_LABELS[state]).toBeTruthy();
    });
  });
});

describe('retrying', () => {
  it('sends the id and reason to the server', async () => {
    mocked.rpc.mockReturnValue(rpcResult(record()));

    await reconciliationService.retry('rec-1', 'customer contacted support');

    expect(mocked.rpc).toHaveBeenCalledWith('admin_retry_payment_reconciliation', {
      p_id: 'rec-1',
      p_reason: 'customer contacted support',
    });
  });

  it('never sends an amount or a refund identity from the client', async () => {
    mocked.rpc.mockReturnValue(rpcResult(record()));

    await reconciliationService.retry('rec-1', 'why');

    const payload = mocked.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['p_id', 'p_reason']);
    expect(payload).not.toHaveProperty('p_amount');
    expect(payload).not.toHaveProperty('p_provider_refund_id');
    expect(payload).not.toHaveProperty('p_provider_idempotency_key');
  });

  it('surfaces a refused retry on a resolved refund', async () => {
    mocked.rpc.mockReturnValue(
      Promise.resolve({ data: null, error: new Error('This refund is already settled') })
    );

    await expect(reconciliationService.retry('rec-1', 'again')).rejects.toThrow('already settled');
  });

  it('surfaces a refused retry while a worker lease is live', async () => {
    mocked.rpc.mockReturnValue(
      Promise.resolve({ data: null, error: new Error('A worker is already retrying this refund') })
    );

    await expect(reconciliationService.retry('rec-1', 'again')).rejects.toThrow(
      'already retrying'
    );
  });

  it('surfaces a refused retry for a non admin', async () => {
    mocked.rpc.mockReturnValue(
      Promise.resolve({ data: null, error: new Error('Administrator access is required') })
    );

    await expect(reconciliationService.retry('rec-1', 'let me in')).rejects.toThrow(
      'Administrator access is required'
    );
  });
});
