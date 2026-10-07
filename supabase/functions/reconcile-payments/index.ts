import {
  classifyProviderError,
  decideFromCreatedRefund,
  decideFromExistingRefunds,
  isUnprocessableJob,
  toMinorUnits,
  type ProviderRefund,
  type ReconciliationJob,
} from '../_shared/reconcileLogic.ts';
import { corsHeaders, json, requireEnv, serviceClient, stripeClient } from '../_shared/stripe.ts';

const isAuthorised = (req: Request): boolean => {
  const header = req.headers.get('Authorization') ?? '';
  const expected = `Bearer ${requireEnv('SUPABASE_SERVICE_ROLE_KEY')}`;
  if (header.length !== expected.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!isAuthorised(req)) return json({ error: 'Unauthorized' }, 401);

  const supabase = serviceClient();
  const stripe = stripeClient();

  const { data: claimed, error: claimError } = await supabase.rpc(
    'claim_payment_reconciliations',
    { p_limit: 20, p_lease_seconds: 300 }
  );

  if (claimError) return json({ error: claimError.message }, 500);

  const work = (claimed ?? []) as ReconciliationJob[];
  const outcome = { claimed: work.length, resolved: 0, waiting: 0, settled: 0, failed: 0 };

  const fail = async (job: ReconciliationJob, message: string) => {
    await supabase.rpc('fail_payment_reconciliation', {
      p_id: job.reconciliation_id,
      p_error: message,
    });
    outcome.failed += 1;
  };

  const wait = async (
    job: ReconciliationJob,
    refundId: string | null,
    providerStatus: string,
    retryAfterSeconds: number
  ) => {
    await supabase.rpc('record_payment_reconciliation_outcome', {
      p_id: job.reconciliation_id,
      p_provider_refund_id: refundId,
      p_provider_status: providerStatus,
      p_retry_after_seconds: retryAfterSeconds,
    });
    outcome.waiting += 1;
  };

  const resolve = async (job: ReconciliationJob, refundId: string) => {
    const { error } = await supabase.rpc('resolve_payment_reconciliation', {
      p_id: job.reconciliation_id,
      p_provider_refund_id: refundId,
      p_provider_event_id: `reconcile-${job.reconciliation_id}`,
      p_payload: { reconciled: true, attempts: job.attempts },
    });

    if (error) {
      await fail(job, `Refund ${refundId} succeeded but was not recorded: ${error.message}`);
      return;
    }

    outcome.resolved += 1;
  };

  for (const job of work) {
    const unprocessable = isUnprocessableJob(job);
    if (unprocessable) {
      await fail(job, unprocessable);
      continue;
    }

    try {
      const existing = await stripe.refunds.list({
        payment_intent: job.provider_intent_id!,
        limit: 100,
      });

      const decision = decideFromExistingRefunds(
        (existing.data ?? []) as unknown as ProviderRefund[],
        job
      );

      if (decision.kind === 'resolve') {
        await resolve(job, decision.refundId);
        continue;
      }

      if (decision.kind === 'already_settled') {
        const { error } = await supabase.rpc('resolve_payment_reconciliation', {
          p_id: job.reconciliation_id,
          p_provider_refund_id: decision.refundId,
          p_provider_event_id: `reconcile-settled-${job.reconciliation_id}`,
          p_payload: { already_settled: true },
        });
        if (error) {
          await fail(job, `The payment is already refunded but was not recorded: ${error.message}`);
          continue;
        }
        outcome.settled += 1;
        continue;
      }

      if (decision.kind === 'wait') {
        await wait(job, decision.refundId, decision.providerStatus, decision.retryAfterSeconds);
        continue;
      }

      if (decision.kind === 'fail') {
        await fail(job, decision.error);
        continue;
      }

      const refund = await stripe.refunds.create(
        {
          payment_intent: job.provider_intent_id!,
          amount: toMinorUnits(job.amount),
          reason: 'requested_by_customer',
          metadata: {
            order_id: job.order_id,
            reconciliation_id: job.reconciliation_id,
            kind: job.kind,
          },
        },
        { idempotencyKey: `reconcile-${job.provider_idempotency_key}` }
      );

      const created = decideFromCreatedRefund(refund as unknown as ProviderRefund);

      if (created.kind === 'resolve') {
        await resolve(job, created.refundId);
      } else if (created.kind === 'wait') {
        await wait(job, created.refundId, created.providerStatus, created.retryAfterSeconds);
      } else if (created.kind === 'fail') {
        await fail(job, created.error);
      }
    } catch (error) {
      const classified = classifyProviderError(
        error as { type?: string; code?: string; message?: string; statusCode?: number }
      );

      if (classified.alreadyRefunded) {
        await wait(job, null, 'already_refunded_at_provider', 60);
        continue;
      }

      await fail(job, classified.message);
    }
  }

  return json(outcome);
});
