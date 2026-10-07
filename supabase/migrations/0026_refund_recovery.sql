alter table public.payment_reconciliations
  add column if not exists locked_at timestamptz,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists provider_refund_id text,
  add column if not exists provider_status text,
  add column if not exists resolved_at timestamptz;

create index if not exists payment_reconciliations_state_idx
  on public.payment_reconciliations (state, created_at desc);

create or replace function public.sanitize_error_text(p_error text)
returns text
language sql
immutable
as $$
  select left(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          coalesce(p_error, ''),
          '(?i)bearer\s+\S+', '[redacted]', 'g'
        ),
        '(?i)(authorization|api[_-]?key|apikey|secret|token)\s*[:=]\s*\S+', '[redacted]', 'g'
      ),
      '(sk|rk|pk)_[A-Za-z0-9_]+', '[redacted]', 'g'
    ),
    300
  );
$$;

drop function if exists public.claim_payment_reconciliations(int);

create or replace function public.claim_payment_reconciliations(
  p_limit int default 20,
  p_lease_seconds int default 300
)
returns table (
  reconciliation_id uuid,
  payment_id uuid,
  order_id uuid,
  provider_intent_id text,
  provider_charge_id text,
  amount numeric,
  currency text,
  reason text,
  provider_idempotency_key uuid,
  attempts int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_lease int := least(greatest(coalesce(p_lease_seconds, 300), 30), 3600);
begin
  return query
  with claimed as (
    update public.payment_reconciliations r
       set state = 'in_progress',
           attempts = r.attempts + 1,
           locked_at = now(),
           last_attempt_at = now(),
           next_attempt_at = now() + make_interval(
             secs => greatest(v_lease, least(3600, (30 * power(2, r.attempts))::int))
           ),
           updated_at = now()
     where r.id in (
       select c.id
         from public.payment_reconciliations c
        where c.state in ('pending', 'in_progress')
          and c.next_attempt_at <= now()
        order by c.next_attempt_at
        limit v_limit
        for update skip locked
     )
    returning r.*
  )
  select c.id, c.payment_id, c.order_id, p.provider_intent_id, p.provider_charge_id,
         c.amount, p.currency, c.reason, c.provider_idempotency_key, c.attempts
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
  v_outstanding numeric(10,2);
begin
  select * into v_row from public.payment_reconciliations where id = p_id for update;
  if not found then
    raise exception 'Unknown reconciliation' using errcode = 'P0002';
  end if;

  if v_row.state = 'resolved' then
    return v_row;
  end if;

  select * into v_payment from public.payments where id = v_row.payment_id for update;
  v_outstanding := v_payment.amount - v_payment.amount_refunded;

  if v_outstanding <= 0 then
    update public.payment_reconciliations
       set state = 'resolved',
           provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id),
           provider_status = 'already_refunded',
           resolved_at = now(),
           locked_at = null,
           last_error = null,
           updated_at = now()
     where id = p_id
    returning * into v_row;
    return v_row;
  end if;

  v_refund := public.record_refund(
    v_payment.provider_intent_id,
    p_provider_refund_id,
    least(v_row.amount, v_outstanding),
    v_row.reason,
    p_provider_event_id,
    coalesce(p_payload, '{}'::jsonb)
  );

  update public.payment_reconciliations
     set state = 'resolved',
         resolved_refund_id = v_refund.id,
         provider_refund_id = p_provider_refund_id,
         provider_status = 'succeeded',
         resolved_at = now(),
         locked_at = null,
         last_error = null,
         updated_at = now()
   where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.record_payment_reconciliation_outcome(
  p_id uuid,
  p_provider_refund_id text,
  p_provider_status text,
  p_retry_after_seconds int default 300
)
returns public.payment_reconciliations
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.payment_reconciliations;
begin
  update public.payment_reconciliations
     set provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id),
         provider_status = p_provider_status,
         state = case when state = 'resolved' then 'resolved' else 'pending' end,
         locked_at = null,
         next_attempt_at = now() + make_interval(
           secs => least(greatest(coalesce(p_retry_after_seconds, 300), 30), 3600)
         ),
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
     set last_error = public.sanitize_error_text(p_error),
         state = case when attempts >= 10 then 'abandoned' else 'pending' end,
         locked_at = null,
         updated_at = now()
   where id = p_id
     and state <> 'resolved'
  returning * into v_row;

  return v_row;
end;
$$;

drop function if exists public.admin_payment_reconciliations();

create or replace function public.admin_payment_reconciliations(
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  order_id uuid,
  payment_id uuid,
  provider_intent_id text,
  amount numeric,
  currency text,
  state text,
  attempts int,
  last_error text,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  lease_active boolean,
  provider_status text,
  resolved_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.order_id,
    r.payment_id,
    p.provider_intent_id,
    r.amount,
    p.currency,
    r.state,
    r.attempts,
    public.sanitize_error_text(r.last_error) as last_error,
    r.last_attempt_at,
    r.next_attempt_at,
    (r.state = 'in_progress' and r.next_attempt_at > now()) as lease_active,
    r.provider_status,
    r.resolved_at,
    r.created_at
  from public.payment_reconciliations r
  join public.payments p on p.id = r.payment_id
 where public.is_admin()
 order by
   case r.state when 'abandoned' then 0 when 'pending' then 1 when 'in_progress' then 2 else 3 end,
   r.created_at desc
 limit public.search_page_size(p_limit)
offset public.search_page_offset(p_offset);
$$;

create or replace function public.admin_retry_payment_reconciliation(
  p_id uuid,
  p_reason text
)
returns public.payment_reconciliations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payment_reconciliations;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.require_admin();

  if v_reason is null then
    raise exception 'A reason is required to retry a refund' using errcode = '22023';
  end if;

  select * into v_row from public.payment_reconciliations where id = p_id for update;

  if not found then
    raise exception 'Unknown reconciliation' using errcode = 'P0002';
  end if;

  if v_row.state = 'resolved' then
    raise exception 'This refund is already settled' using errcode = '42501';
  end if;

  if v_row.state = 'in_progress' and v_row.next_attempt_at > now() then
    raise exception 'A worker is already retrying this refund' using errcode = '55006';
  end if;

  update public.payment_reconciliations
     set state = 'pending',
         next_attempt_at = now(),
         locked_at = null,
         updated_at = now()
   where id = p_id
  returning * into v_row;

  insert into public.admin_actions (admin_id, action, subject_type, subject_id, details)
  values (
    auth.uid(),
    'retry_payment_reconciliation',
    'payment_reconciliation',
    p_id::text,
    jsonb_build_object(
      'reason', v_reason,
      'attempts', v_row.attempts,
      'order_id', v_row.order_id,
      'amount', v_row.amount
    )
  );

  return v_row;
end;
$$;

create or replace function public.invoke_reconcile_payments()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_key text;
  v_request_id bigint;
begin
  if to_regnamespace('vault') is null then
    return 'vault is unavailable: configure the worker schedule by hand';
  end if;

  if to_regproc('net.http_post') is null then
    return 'pg_net is unavailable: configure the worker schedule by hand';
  end if;

  execute $q$
    select decrypted_secret from vault.decrypted_secrets where name = 'wolt_functions_url'
  $q$ into v_url;

  execute $q$
    select decrypted_secret from vault.decrypted_secrets where name = 'wolt_service_role_key'
  $q$ into v_key;

  if v_url is null or v_key is null then
    return 'worker secrets are not configured in vault';
  end if;

  execute format(
    'select net.http_post(url => %L, headers => %L::jsonb, body => %L::jsonb)',
    rtrim(v_url, '/') || '/reconcile-payments',
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    )::text,
    '{}'::text
  ) into v_request_id;

  return 'queued';
end;
$$;

do $$
declare v_job record;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available: schedule wolt-reconcile-payments by hand';
    return;
  end if;

  execute 'create extension if not exists pg_cron';

  for v_job in
    select *
      from (values
        ('wolt-reconcile-payments', '*/5 * * * *', 'select public.invoke_reconcile_payments()')
      ) as j(name, schedule, command)
  loop
    if exists (select 1 from cron.job where jobname = v_job.name) then
      perform cron.unschedule(v_job.name);
    end if;

    perform cron.schedule(v_job.name, v_job.schedule, v_job.command);
  end loop;
end
$$;

revoke all on function public.sanitize_error_text(text) from public, anon;
revoke all on function public.claim_payment_reconciliations(int, int)
  from public, anon, authenticated;
revoke all on function public.resolve_payment_reconciliation(uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.record_payment_reconciliation_outcome(uuid, text, text, int)
  from public, anon, authenticated;
revoke all on function public.fail_payment_reconciliation(uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_payment_reconciliations(int, int) from public, anon;
revoke all on function public.admin_retry_payment_reconciliation(uuid, text) from public, anon;
revoke all on function public.invoke_reconcile_payments() from public, anon, authenticated;

grant execute on function public.sanitize_error_text(text) to authenticated;
grant execute on function public.claim_payment_reconciliations(int, int) to service_role;
grant execute on function public.resolve_payment_reconciliation(uuid, text, text, jsonb) to service_role;
grant execute on function public.record_payment_reconciliation_outcome(uuid, text, text, int)
  to service_role;
grant execute on function public.fail_payment_reconciliation(uuid, text) to service_role;
grant execute on function public.admin_payment_reconciliations(int, int) to authenticated;
grant execute on function public.admin_retry_payment_reconciliation(uuid, text) to authenticated;
grant execute on function public.invoke_reconcile_payments() to service_role;
