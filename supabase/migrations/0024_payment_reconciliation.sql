create table if not exists public.payment_reconciliations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  kind text not null check (kind in ('refund_unfulfilled_order')),
  amount numeric(10,2) not null check (amount > 0),
  reason text,
  state text not null default 'pending'
    check (state in ('pending', 'in_progress', 'resolved', 'abandoned')),
  attempts int not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  provider_idempotency_key uuid not null default gen_random_uuid(),
  resolved_refund_id uuid references public.refunds (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists payment_reconciliations_open_idx
  on public.payment_reconciliations (payment_id, kind)
  where state <> 'resolved';

create index if not exists payment_reconciliations_due_idx
  on public.payment_reconciliations (state, next_attempt_at)
  where state in ('pending', 'in_progress');

create index if not exists payment_reconciliations_order_idx
  on public.payment_reconciliations (order_id);

alter table public.payment_reconciliations enable row level security;

revoke all on public.payment_reconciliations from anon, authenticated;
grant select on public.payment_reconciliations to authenticated;

drop policy if exists "read own reconciliations" on public.payment_reconciliations;
create policy "read own reconciliations" on public.payment_reconciliations
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.orders o
       where o.id = order_id and o.user_id = auth.uid()
    )
  );

create or replace function public.order_is_fulfillable(p_status public.order_status)
returns boolean
language sql
immutable
as $$
  select p_status not in (
    'payment_failed'::public.order_status,
    'restaurant_rejected'::public.order_status,
    'cancelled'::public.order_status,
    'refunded'::public.order_status
  );
$$;

create or replace function public.post_order_charge_only(p_order_id uuid, p_memo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.platform_settings;
  v_order public.orders;
begin
  select * into s from public.platform_settings where id;
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return;
  end if;

  insert into public.ledger_entries (order_id, entry_type, party_type, party_id, amount, currency, memo)
  values (p_order_id, 'charge', 'customer', v_order.user_id, v_order.total, s.currency, p_memo)
  on conflict do nothing;
end;
$$;

create or replace function public.enqueue_payment_reconciliation(
  p_payment_id uuid,
  p_kind text,
  p_amount numeric,
  p_reason text default null
)
returns public.payment_reconciliations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
  v_row public.payment_reconciliations;
begin
  select * into v_payment from public.payments where id = p_payment_id;
  if not found then
    raise exception 'Unknown payment' using errcode = '23503';
  end if;

  if p_amount is null or p_amount <= 0 then
    return null;
  end if;

  insert into public.payment_reconciliations (payment_id, order_id, kind, amount, reason)
  values (p_payment_id, v_payment.order_id, p_kind, p_amount, p_reason)
  on conflict do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
      from public.payment_reconciliations
     where payment_id = p_payment_id and kind = p_kind and state <> 'resolved';
  end if;

  return v_row;
end;
$$;

create or replace function public.confirm_payment(
  p_provider_intent_id text,
  p_provider_charge_id text default null,
  p_provider_event_id text default null,
  p_payload jsonb default '{}'::jsonb
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
  v_order public.orders;
  v_outstanding numeric(10,2);
begin
  select * into v_payment
    from public.payments
   where provider_intent_id = p_provider_intent_id
   for update;

  if not found then
    raise exception 'Unknown payment intent' using errcode = '23503';
  end if;

  insert into public.payment_transactions (
    payment_id, provider_event_id, event_type, status, amount, payload
  )
  values (v_payment.id, p_provider_event_id, 'payment_intent.succeeded', 'succeeded',
          v_payment.amount, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider_event_id) do nothing;

  if v_payment.status = 'succeeded' then
    return v_payment;
  end if;

  update public.payments
     set status = 'succeeded',
         provider_charge_id = coalesce(p_provider_charge_id, provider_charge_id),
         failure_reason = null
   where id = v_payment.id
   returning * into v_payment;

  select * into v_order from public.orders where id = v_payment.order_id for update;

  if v_order.status = 'pending_payment' then
    perform public.transition_order_status(v_payment.order_id, 'placed'::public.order_status);
    select * into v_order from public.orders where id = v_payment.order_id;
  end if;

  if public.order_is_fulfillable(v_order.status) then
    perform public.post_order_ledger(v_payment.order_id, 'card');
    return v_payment;
  end if;

  perform public.post_order_charge_only(
    v_payment.order_id, 'card captured after the order was closed');

  v_outstanding := v_payment.amount - v_payment.amount_refunded;

  if v_outstanding > 0 then
    perform public.enqueue_payment_reconciliation(
      v_payment.id,
      'refund_unfulfilled_order',
      v_outstanding,
      format('Payment confirmed after the order reached %s', v_order.status)
    );
  end if;

  return v_payment;
end;
$$;

create or replace function public.claim_payment_reconciliations(p_limit int default 20)
returns table (
  reconciliation_id uuid,
  payment_id uuid,
  order_id uuid,
  provider_intent_id text,
  provider_charge_id text,
  amount numeric,
  reason text,
  provider_idempotency_key uuid,
  attempts int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    update public.payment_reconciliations r
       set state = 'in_progress',
           attempts = r.attempts + 1,
           next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, r.attempts)::int)),
           updated_at = now()
     where r.id in (
       select c.id
         from public.payment_reconciliations c
        where c.state in ('pending', 'in_progress')
          and c.next_attempt_at <= now()
        order by c.next_attempt_at
        limit greatest(coalesce(p_limit, 20), 1)
        for update skip locked
     )
    returning r.*
  )
  select c.id, c.payment_id, c.order_id, p.provider_intent_id, p.provider_charge_id,
         c.amount, c.reason, c.provider_idempotency_key, c.attempts
    from claimed c
    join public.payments p on p.id = c.payment_id;
end;
$$;

create or replace function public.resolve_payment_reconciliation(
  p_id uuid,
  p_provider_refund_id text,
  p_provider_event_id text default null,
  p_payload jsonb default '{}'::jsonb
)
returns public.payment_reconciliations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payment_reconciliations;
  v_payment public.payments;
  v_refund public.refunds;
begin
  select * into v_row from public.payment_reconciliations where id = p_id for update;
  if not found then
    raise exception 'Unknown reconciliation' using errcode = 'P0002';
  end if;

  if v_row.state = 'resolved' then
    return v_row;
  end if;

  select * into v_payment from public.payments where id = v_row.payment_id;

  v_refund := public.record_refund(
    v_payment.provider_intent_id,
    p_provider_refund_id,
    least(v_row.amount, v_payment.amount - v_payment.amount_refunded),
    v_row.reason,
    p_provider_event_id,
    coalesce(p_payload, '{}'::jsonb)
  );

  update public.payment_reconciliations
     set state = 'resolved',
         resolved_refund_id = v_refund.id,
         last_error = null,
         updated_at = now()
   where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.fail_payment_reconciliation(p_id uuid, p_error text)
returns public.payment_reconciliations
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.payment_reconciliations;
begin
  update public.payment_reconciliations
     set last_error = left(coalesce(p_error, 'unknown error'), 500),
         state = case when attempts >= 10 then 'abandoned' else 'pending' end,
         updated_at = now()
   where id = p_id
     and state <> 'resolved'
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.admin_payment_reconciliations()
returns table (
  id uuid,
  order_id uuid,
  amount numeric,
  state text,
  attempts int,
  last_error text,
  next_attempt_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.order_id, r.amount, r.state, r.attempts, r.last_error,
         r.next_attempt_at, r.created_at
    from public.payment_reconciliations r
   where public.is_admin()
   order by
     case when r.state = 'resolved' then 1 else 0 end,
     r.created_at desc;
$$;

revoke all on function public.order_is_fulfillable(public.order_status) from public, anon;
revoke all on function public.post_order_charge_only(uuid, text) from public, anon, authenticated;
revoke all on function public.enqueue_payment_reconciliation(uuid, text, numeric, text)
  from public, anon, authenticated;
revoke all on function public.claim_payment_reconciliations(int) from public, anon, authenticated;
revoke all on function public.resolve_payment_reconciliation(uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.fail_payment_reconciliation(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_payment_reconciliations() from public, anon;

grant execute on function public.order_is_fulfillable(public.order_status) to authenticated;
grant execute on function public.claim_payment_reconciliations(int) to service_role;
grant execute on function public.resolve_payment_reconciliation(uuid, text, text, jsonb) to service_role;
grant execute on function public.fail_payment_reconciliation(uuid, text) to service_role;
grant execute on function public.admin_payment_reconciliations() to authenticated;
