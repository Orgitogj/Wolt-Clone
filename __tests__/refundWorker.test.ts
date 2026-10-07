import {
  chargedMinorUnits,
  classifyProviderError,
  decideFromCreatedRefund,
  decideFromExistingRefunds,
  isUnprocessableJob,
  refundBelongsToJob,
  succeededRefundTotal,
  toMinorUnits,
  type ProviderRefund,
  type ReconciliationJob,
} from '../supabase/functions/_shared/reconcileLogic';

const job = (overrides: Partial<ReconciliationJob> = {}): ReconciliationJob => ({
  reconciliation_id: 'rec-1',
  payment_id: 'pay-1',
  order_id: 'order-1',
  kind: 'refund_unfulfilled_order',
  provider_intent_id: 'pi_1',
  provider_charge_id: 'ch_1',
  amount: 23.5,
  payment_amount: 23.5,
  currency: 'EUR',
  reason: 'Order closed before payment',
  provider_idempotency_key: 'key-1',
  attempts: 1,
  ...overrides,
});

const refund = (overrides: Partial<ProviderRefund> = {}): ProviderRefund => ({
  id: 're_1',
  status: 'succeeded',
  amount: 2350,
  currency: 'eur',
  metadata: { reconciliation_id: 'rec-1' },
  ...overrides,
});

describe('job preconditions', () => {
  it('refuses a job without a provider intent', () => {
    expect(isUnprocessableJob(job({ provider_intent_id: null }))).toMatch(/no provider intent/);
  });

  it('refuses a job with no amount', () => {
    expect(isUnprocessableJob(job({ amount: 0 }))).toMatch(/no amount/);
  });

  it('accepts a well formed job', () => {
    expect(isUnprocessableJob(job())).toBeNull();
  });

  it('converts money to minor units', () => {
    expect(toMinorUnits(23.5)).toBe(2350);
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
  });
});

describe('recovering a refund this job already created', () => {
  it('resolves when our refund succeeded', () => {
    const decision = decideFromExistingRefunds([refund()], job());

    expect(decision).toEqual({ kind: 'resolve', refundId: 're_1', providerStatus: 'succeeded' });
  });

  it('recovers a crash between provider success and database persistence', () => {
    const decision = decideFromExistingRefunds([refund({ id: 're_lost' })], job());

    expect(decision.kind).toBe('resolve');
    expect(decision).toMatchObject({ refundId: 're_lost' });
  });

  it('recovers beyond the provider idempotency window because it matches on metadata', () => {
    const decision = decideFromExistingRefunds(
      [refund({ id: 're_old', metadata: { reconciliation_id: 'rec-1' } })],
      job({ provider_idempotency_key: 'a-brand-new-key' })
    );

    expect(decision.kind).toBe('resolve');
  });

  it('never creates a second refund while ours is still pending', () => {
    const decision = decideFromExistingRefunds([refund({ status: 'pending' })], job());

    expect(decision.kind).toBe('wait');
    expect(decision).toMatchObject({ providerStatus: 'pending', refundId: 're_1' });
  });

  it('waits on an unknown provider status rather than refunding again', () => {
    const decision = decideFromExistingRefunds([refund({ status: 'something_new' })], job());

    expect(decision.kind).toBe('wait');
  });

  it('reports a failed refund as retryable', () => {
    const decision = decideFromExistingRefunds([refund({ status: 'failed' })], job());

    expect(decision).toMatchObject({ kind: 'fail', retryable: true });
  });

  it('matches our refund only by reconciliation id', () => {
    expect(refundBelongsToJob(refund(), job())).toBe(true);
    expect(refundBelongsToJob(refund({ metadata: { reconciliation_id: 'other' } }), job())).toBe(
      false
    );
    expect(refundBelongsToJob(refund({ metadata: null }), job())).toBe(false);
  });
});

describe('payments already refunded by someone else', () => {
  it('settles without creating another refund', () => {
    const decision = decideFromExistingRefunds(
      [refund({ id: 're_manual', metadata: { reconciliation_id: 'different' } })],
      job()
    );

    expect(decision).toEqual({ kind: 'already_settled', refundId: 're_manual' });
  });

  it('only settles when the succeeded total covers the amount owed', () => {
    const decision = decideFromExistingRefunds(
      [refund({ id: 're_part', amount: 500, metadata: { reconciliation_id: 'different' } })],
      job()
    );

    expect(decision.kind).toBe('create');
  });

  it('adds up several succeeded refunds', () => {
    expect(
      succeededRefundTotal([
        refund({ amount: 1000 }),
        refund({ amount: 1350 }),
        refund({ amount: 9999, status: 'failed' }),
      ])
    ).toBe(2350);
  });

  it('waits when someone else has a pending refund in flight', () => {
    const decision = decideFromExistingRefunds(
      [refund({ id: 're_other', status: 'pending', metadata: { reconciliation_id: 'different' } })],
      job()
    );

    expect(decision.kind).toBe('wait');
    expect(decision).toMatchObject({ refundId: 're_other' });
  });

  it('creates a refund when the provider has none at all', () => {
    expect(decideFromExistingRefunds([], job())).toEqual({ kind: 'create' });
  });
});

describe('interpreting a refund we just created', () => {
  it('resolves on success', () => {
    expect(decideFromCreatedRefund(refund())).toEqual({
      kind: 'resolve',
      refundId: 're_1',
      providerStatus: 'succeeded',
    });
  });

  it('never reports completion while the provider outcome is pending', () => {
    const decision = decideFromCreatedRefund(refund({ status: 'pending' }));

    expect(decision.kind).toBe('wait');
    expect(decision).not.toMatchObject({ kind: 'resolve' });
  });

  it('treats processing as pending rather than done', () => {
    expect(decideFromCreatedRefund(refund({ status: 'processing' })).kind).toBe('wait');
  });

  it('fails a refund the provider cancelled', () => {
    expect(decideFromCreatedRefund(refund({ status: 'canceled' })).kind).toBe('fail');
  });
});

describe('classifying provider errors', () => {
  it('retries a rate limit', () => {
    expect(classifyProviderError({ type: 'StripeRateLimitError', message: 'slow down' })).toMatchObject({
      retryable: true,
      alreadyRefunded: false,
    });
  });

  it('retries a connection failure', () => {
    expect(
      classifyProviderError({ type: 'StripeConnectionError', message: 'timeout' })
    ).toMatchObject({ retryable: true });
  });

  it('retries a server side failure', () => {
    expect(classifyProviderError({ statusCode: 503, message: 'upstream' })).toMatchObject({
      retryable: true,
    });
  });

  it('retries an http 429', () => {
    expect(classifyProviderError({ statusCode: 429, message: 'too many' })).toMatchObject({
      retryable: true,
    });
  });

  it('recognises an already refunded charge', () => {
    expect(
      classifyProviderError({ code: 'charge_already_refunded', message: 'already refunded' })
    ).toMatchObject({ alreadyRefunded: true, retryable: false });
  });

  it('treats an unknown request error as not retryable', () => {
    expect(
      classifyProviderError({ type: 'StripeInvalidRequestError', message: 'no such intent' })
    ).toMatchObject({ retryable: false, alreadyRefunded: false });
  });

  it('always carries a message', () => {
    expect(classifyProviderError({}).message).toBe('Unknown refund failure');
  });
});

describe('the worker never double refunds', () => {
  it('only reaches the create branch when the provider shows nothing for this job', () => {
    const scenarios: { refunds: ProviderRefund[]; expected: string }[] = [
      { refunds: [], expected: 'create' },
      { refunds: [refund()], expected: 'resolve' },
      { refunds: [refund({ status: 'pending' })], expected: 'wait' },
      {
        refunds: [refund({ metadata: { reconciliation_id: 'other' } })],
        expected: 'already_settled',
      },
      {
        refunds: [
          refund({ id: 're_small', amount: 100, metadata: { reconciliation_id: 'other' } }),
        ],
        expected: 'create',
      },
    ];

    scenarios.forEach((scenario) => {
      expect(decideFromExistingRefunds(scenario.refunds, job()).kind).toBe(scenario.expected);
    });
  });
});

describe('partial support refunds on a payment that already has refunds', () => {
  const supportJob = (overrides: Partial<ReconciliationJob> = {}) =>
    job({
      reconciliation_id: 'rec-support',
      kind: 'support_refund',
      amount: 5,
      payment_amount: 30,
      provider_idempotency_key: 'support-key',
      ...overrides,
    });

  it('creates its own refund even though an earlier refund covers the amount', () => {
    const decision = decideFromExistingRefunds(
      [refund({ id: 're_earlier', amount: 1000, metadata: { reconciliation_id: 'rec-older' } })],
      supportJob()
    );

    expect(decision.kind).toBe('create');
  });

  it('settles only once the provider has refunded the whole charge', () => {
    const decision = decideFromExistingRefunds(
      [
        refund({ id: 're_a', amount: 1000, metadata: { reconciliation_id: 'rec-older' } }),
        refund({ id: 're_b', amount: 2000, metadata: { reconciliation_id: 'rec-other' } }),
      ],
      supportJob()
    );

    expect(decision).toEqual({ kind: 'already_settled', refundId: 're_a' });
  });

  it('recognises its own partial refund by the job it belongs to', () => {
    const ours = refund({
      id: 're_ours',
      amount: 500,
      metadata: { reconciliation_id: 'rec-support' },
    });

    const decision = decideFromExistingRefunds(
      [refund({ id: 're_earlier', amount: 1000, metadata: { reconciliation_id: 'rec-older' } }), ours],
      supportJob()
    );

    expect(decision).toEqual({ kind: 'resolve', refundId: 're_ours', providerStatus: 'succeeded' });
  });

  it('waits rather than racing another refund that is still in flight', () => {
    const decision = decideFromExistingRefunds(
      [
        refund({
          id: 're_inflight',
          amount: 400,
          status: 'pending',
          metadata: { reconciliation_id: 'rec-other' },
        }),
      ],
      supportJob()
    );

    expect(decision.kind).toBe('wait');
    expect(decision).toMatchObject({ refundId: 're_inflight' });
  });

  it('keeps two partial refunds on one payment independent', () => {
    const first = supportJob({ reconciliation_id: 'rec-one', provider_idempotency_key: 'key-one' });
    const second = supportJob({ reconciliation_id: 'rec-two', provider_idempotency_key: 'key-two' });

    const afterFirst = [
      refund({ id: 're_one', amount: 500, metadata: { reconciliation_id: 'rec-one' } }),
    ];

    expect(decideFromExistingRefunds(afterFirst, first)).toMatchObject({
      kind: 'resolve',
      refundId: 're_one',
    });
    expect(decideFromExistingRefunds(afterFirst, second).kind).toBe('create');
  });

  it('refuses a job that asks for more than the payment collected', () => {
    expect(isUnprocessableJob(supportJob({ amount: 31 }))).toMatch(/more than the payment/);
    expect(isUnprocessableJob(supportJob({ amount: 30 }))).toBeNull();
  });

  it('reports the charge in minor units for the job it is given', () => {
    expect(chargedMinorUnits(supportJob())).toBe(3000);
    expect(chargedMinorUnits(job())).toBe(2350);
  });
});
