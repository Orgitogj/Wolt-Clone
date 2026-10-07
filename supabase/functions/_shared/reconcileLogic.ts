export interface ReconciliationJob {
  reconciliation_id: string;
  payment_id: string;
  order_id: string;
  kind: string;
  provider_intent_id: string | null;
  provider_charge_id: string | null;
  amount: number;
  payment_amount: number;
  currency: string | null;
  reason: string | null;
  provider_idempotency_key: string;
  attempts: number;
}

export interface ProviderRefund {
  id: string;
  status: string;
  amount: number;
  currency?: string;
  metadata?: Record<string, string> | null;
}

export type ReconcileAction =
  | { kind: 'resolve'; refundId: string; providerStatus: string }
  | { kind: 'already_settled'; refundId: string | null }
  | { kind: 'wait'; refundId: string | null; providerStatus: string; retryAfterSeconds: number }
  | { kind: 'create' }
  | { kind: 'fail'; error: string; retryable: boolean };

export const SUCCEEDED = 'succeeded';
export const PENDING_STATUSES = ['pending', 'requires_action', 'processing'];
export const DEAD_STATUSES = ['failed', 'canceled', 'cancelled'];

export const toMinorUnits = (amount: number): number => Math.round(Number(amount) * 100);

export const refundBelongsToJob = (refund: ProviderRefund, job: ReconciliationJob): boolean =>
  refund.metadata?.reconciliation_id === job.reconciliation_id;

export const chargedMinorUnits = (job: ReconciliationJob): number =>
  toMinorUnits(Number(job.payment_amount ?? job.amount));

export const succeededRefundTotal = (refunds: ProviderRefund[]): number =>
  refunds
    .filter((refund) => refund.status === SUCCEEDED)
    .reduce((total, refund) => total + Number(refund.amount ?? 0), 0);

export const decideFromExistingRefunds = (
  refunds: ProviderRefund[],
  job: ReconciliationJob
): ReconcileAction => {
  const ours = refunds.find((refund) => refundBelongsToJob(refund, job));

  if (ours) {
    if (ours.status === SUCCEEDED) {
      return { kind: 'resolve', refundId: ours.id, providerStatus: ours.status };
    }

    if (PENDING_STATUSES.includes(ours.status)) {
      return {
        kind: 'wait',
        refundId: ours.id,
        providerStatus: ours.status,
        retryAfterSeconds: 300,
      };
    }

    if (DEAD_STATUSES.includes(ours.status)) {
      return {
        kind: 'fail',
        error: `The refund ${ours.id} ended as ${ours.status}`,
        retryable: true,
      };
    }

    return {
      kind: 'wait',
      refundId: ours.id,
      providerStatus: ours.status,
      retryAfterSeconds: 300,
    };
  }

  const settled = succeededRefundTotal(refunds);
  if (settled >= chargedMinorUnits(job)) {
    const newest = refunds.find((refund) => refund.status === SUCCEEDED) ?? null;
    return { kind: 'already_settled', refundId: newest?.id ?? null };
  }

  const pendingElsewhere = refunds.find((refund) => PENDING_STATUSES.includes(refund.status));
  if (pendingElsewhere) {
    return {
      kind: 'wait',
      refundId: pendingElsewhere.id,
      providerStatus: pendingElsewhere.status,
      retryAfterSeconds: 300,
    };
  }

  return { kind: 'create' };
};

export const decideFromCreatedRefund = (refund: ProviderRefund): ReconcileAction => {
  if (refund.status === SUCCEEDED) {
    return { kind: 'resolve', refundId: refund.id, providerStatus: refund.status };
  }

  if (DEAD_STATUSES.includes(refund.status)) {
    return {
      kind: 'fail',
      error: `The refund ${refund.id} ended as ${refund.status}`,
      retryable: true,
    };
  }

  return {
    kind: 'wait',
    refundId: refund.id,
    providerStatus: refund.status,
    retryAfterSeconds: 300,
  };
};

const RETRYABLE_TYPES = ['StripeConnectionError', 'StripeAPIError', 'StripeRateLimitError'];
const RETRYABLE_CODES = ['lock_timeout', 'rate_limit', 'processing_error'];
const ALREADY_REFUNDED_CODES = ['charge_already_refunded'];

export interface ProviderError {
  type?: string;
  code?: string;
  message?: string;
  statusCode?: number;
}

export const classifyProviderError = (
  error: ProviderError
): { retryable: boolean; alreadyRefunded: boolean; message: string } => {
  const message = error.message ?? 'Unknown refund failure';

  if (error.code && ALREADY_REFUNDED_CODES.includes(error.code)) {
    return { retryable: false, alreadyRefunded: true, message };
  }

  if (error.type && RETRYABLE_TYPES.includes(error.type)) {
    return { retryable: true, alreadyRefunded: false, message };
  }

  if (error.code && RETRYABLE_CODES.includes(error.code)) {
    return { retryable: true, alreadyRefunded: false, message };
  }

  if (error.statusCode === 429 || (error.statusCode ?? 0) >= 500) {
    return { retryable: true, alreadyRefunded: false, message };
  }

  return { retryable: false, alreadyRefunded: false, message };
};

export const isUnprocessableJob = (job: ReconciliationJob): string | null => {
  if (!job.provider_intent_id) return 'The payment has no provider intent to refund';
  if (!(Number(job.amount) > 0)) return 'The reconciliation has no amount to refund';
  if (toMinorUnits(Number(job.amount)) > chargedMinorUnits(job)) {
    return 'The reconciliation asks for more than the payment collected';
  }
  return null;
};
