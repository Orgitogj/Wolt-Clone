\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.assert(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if not p_condition then
    raise exception 'FAIL: %', p_label;
  end if;
  raise notice 'pass: %', p_label;
end;
$$;

create or replace function pg_temp.act_as(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated', 'is_anonymous', false)::text, true);
end;
$$;

create or replace function pg_temp.act_as_system()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create temporary table t_rec (key text primary key, id uuid not null) on commit drop;
grant all on t_rec to anon, authenticated;

insert into auth.users (id, email) values
  (gen_random_uuid(), 'rec-customer@test.local'),
  (gen_random_uuid(), 'rec-other@test.local'),
  (gen_random_uuid(), 'rec-admin@test.local');

insert into t_rec (key, id)
select 'customer', id from auth.users where email = 'rec-customer@test.local'
union all select 'other', id from auth.users where email = 'rec-other@test.local'
union all select 'admin', id from auth.users where email = 'rec-admin@test.local';

update public.profiles set role = 'admin' where id = (select id from t_rec where key = 'admin');
update public.platform_settings set card_payments_enabled = true;

insert into public.restaurants (name, min_order, is_open, latitude, longitude)
values ('Reconcile Kitchen', 0, true, 51.9625, 7.6257);
insert into t_rec (key, id) select 'restaurant', id from public.restaurants where name = 'Reconcile Kitchen';

insert into public.menu_categories (restaurant_id, name)
select id, 'Mains' from t_rec where key = 'restaurant';

insert into public.dishes (restaurant_id, menu_category_id, name, price, is_available)
select r.id, m.id, 'Reconcile Dish', 10.00, true
  from t_rec r join public.menu_categories m on m.restaurant_id = r.id
 where r.key = 'restaurant';
insert into t_rec (key, id) select 'dish', id from public.dishes where name = 'Reconcile Dish';

insert into public.addresses (user_id, label, address_line, latitude, longitude)
select id, 'Home', 'Reconcileweg 1', 51.9650, 7.6300 from t_rec where key = 'customer';
insert into t_rec (key, id) select 'address', id from public.addresses where address_line = 'Reconcileweg 1';

create or replace function pg_temp.place_card_order(p_intent text)
returns uuid language plpgsql as $$
declare v_order public.orders;
begin
  perform pg_temp.act_as((select id from t_rec where key = 'customer'));
  v_order := public.create_order(
    (select id from t_rec where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object(
      'dish_id', (select id from t_rec where key = 'dish'), 'quantity', 2, 'addon_ids', '[]'::jsonb)),
    'delivery', (select id from t_rec where key = 'address'), null, 0, 'card', false, false,
    gen_random_uuid(), null);

  update public.payments set provider_intent_id = p_intent where order_id = v_order.id;
  return v_order.id;
end;
$$;

do $$
declare v_order_id uuid; v_payment public.payments; v_status public.order_status;
begin
  v_order_id := pg_temp.place_card_order('pi_happy');
  perform pg_temp.act_as_system();
  v_payment := public.confirm_payment('pi_happy', 'ch_happy', 'evt_happy', '{}'::jsonb);

  select status into v_status from public.orders where id = v_order_id;
  perform pg_temp.assert(v_status = 'placed', 'a timely payment places the order');
  perform pg_temp.assert(v_payment.status = 'succeeded', 'a timely payment is recorded as succeeded');
  perform pg_temp.assert(
    exists (select 1 from public.ledger_entries
             where order_id = v_order_id and entry_type = 'restaurant_payout'),
    'a fulfillable order posts the full ledger');
  perform pg_temp.assert(
    not exists (select 1 from public.payment_reconciliations where order_id = v_order_id),
    'a timely payment needs no reconciliation');
end;
$$;

do $$
declare v_order_id uuid; v_status public.order_status; v_rec public.payment_reconciliations;
begin
  v_order_id := pg_temp.place_card_order('pi_late');
  insert into t_rec (key, id) values ('late_order', v_order_id);

  update public.orders
     set created_at = now() - make_interval(mins => (
           select payment_hold_minutes + 10 from public.platform_settings))
   where id = v_order_id;
  perform pg_temp.act_as_system();
  perform public.expire_unpaid_orders();

  select status into v_status from public.orders where id = v_order_id;
  perform pg_temp.assert(v_status = 'payment_failed', 'the abandoned order expires');

  perform pg_temp.act_as_system();
  perform public.confirm_payment('pi_late', 'ch_late', 'evt_late', '{}'::jsonb);

  select status into v_status from public.orders where id = v_order_id;
  perform pg_temp.assert(v_status = 'payment_failed', 'a late payment never revives an expired order');

  perform pg_temp.assert(
    (select status from public.payments where order_id = v_order_id) = 'succeeded',
    'the captured money is still recorded as captured');

  select * into v_rec from public.payment_reconciliations where order_id = v_order_id;
  perform pg_temp.assert(v_rec.id is not null, 'a late payment opens a reconciliation');
  perform pg_temp.assert(v_rec.state = 'pending', 'the reconciliation starts pending');
  perform pg_temp.assert(v_rec.kind = 'refund_unfulfilled_order', 'the reconciliation asks for a refund');
  perform pg_temp.assert(
    v_rec.amount = (select total from public.orders where id = v_order_id),
    'the reconciliation covers the whole captured amount');
  insert into t_rec (key, id) values ('late_rec', v_rec.id);
end;
$$;

do $$
declare v_order_id uuid; v_charge numeric; v_payout int;
begin
  v_order_id := (select id from t_rec where key = 'late_order');

  select amount into v_charge from public.ledger_entries
   where order_id = v_order_id and entry_type = 'charge';
  perform pg_temp.assert(
    v_charge = (select total from public.orders where id = v_order_id),
    'the captured charge is recorded in the ledger');

  select count(*) into v_payout from public.ledger_entries
   where order_id = v_order_id and entry_type in ('restaurant_payout', 'platform_commission');
  perform pg_temp.assert(v_payout = 0,
    'an unfulfilled order never books a restaurant payout or commission');
end;
$$;

do $$
declare v_count int;
begin
  perform pg_temp.act_as_system();
  perform public.confirm_payment('pi_late', 'ch_late', 'evt_late_again', '{}'::jsonb);

  select count(*) into v_count from public.payment_reconciliations
   where order_id = (select id from t_rec where key = 'late_order');
  perform pg_temp.assert(v_count = 1, 'a duplicate webhook never opens a second reconciliation');

  select count(*) into v_count from public.ledger_entries
   where order_id = (select id from t_rec where key = 'late_order') and entry_type = 'charge';
  perform pg_temp.assert(v_count = 1, 'a duplicate webhook never double posts the charge');
end;
$$;

do $$
declare v_claimed int; v_attempts int;
begin
  select count(*) into v_claimed from public.claim_payment_reconciliations(10);
  perform pg_temp.assert(v_claimed = 1, 'the worker claims the due reconciliation');

  select attempts into v_attempts
    from public.payment_reconciliations where id = (select id from t_rec where key = 'late_rec');
  perform pg_temp.assert(v_attempts = 1, 'claiming counts an attempt');

  perform pg_temp.assert(
    (select state from public.payment_reconciliations
      where id = (select id from t_rec where key = 'late_rec')) = 'in_progress',
    'a claimed reconciliation is in progress');

  select count(*) into v_claimed from public.claim_payment_reconciliations(10);
  perform pg_temp.assert(v_claimed = 0,
    'a just claimed reconciliation is not handed out again before its backoff');
end;
$$;

do $$
declare v_row public.payment_reconciliations;
begin
  v_row := public.fail_payment_reconciliation(
    (select id from t_rec where key = 'late_rec'), 'Stripe timed out');

  perform pg_temp.assert(v_row.state = 'pending', 'a failed refund returns to the queue');
  perform pg_temp.assert(v_row.last_error = 'Stripe timed out', 'the failure reason stays visible');

  perform pg_temp.act_as((select id from t_rec where key = 'admin'));
  perform pg_temp.assert(
    exists (select 1 from public.admin_payment_reconciliations()
             where id = (select id from t_rec where key = 'late_rec')),
    'a failed refund stays visible to an admin');
  perform pg_temp.act_as_system();
end;
$$;

do $$
declare v_row public.payment_reconciliations; v_payment public.payments; v_refund_total numeric;
begin
  update public.payment_reconciliations set next_attempt_at = now() - interval '1 minute'
   where id = (select id from t_rec where key = 'late_rec');

  perform public.claim_payment_reconciliations(10);

  v_row := public.resolve_payment_reconciliation(
    (select id from t_rec where key = 'late_rec'), 're_late_1', 'evt_refund_1', '{}'::jsonb);

  perform pg_temp.assert(v_row.state = 'resolved', 'a successful refund resolves the reconciliation');
  perform pg_temp.assert(v_row.resolved_refund_id is not null, 'the refund is linked to the reconciliation');

  select * into v_payment from public.payments
   where order_id = (select id from t_rec where key = 'late_order');
  perform pg_temp.assert(v_payment.status = 'refunded', 'the payment ends as refunded');
  perform pg_temp.assert(
    v_payment.amount_refunded = v_payment.amount,
    'the whole captured amount is refunded');

  select coalesce(sum(amount), 0) into v_refund_total from public.ledger_entries
   where order_id = (select id from t_rec where key = 'late_order');
  perform pg_temp.assert(v_refund_total = 0,
    'the ledger nets to zero once the captured money is returned');
end;
$$;

do $$
declare v_row public.payment_reconciliations; v_refunds int;
begin
  v_row := public.resolve_payment_reconciliation(
    (select id from t_rec where key = 'late_rec'), 're_late_1', 'evt_refund_1', '{}'::jsonb);
  perform pg_temp.assert(v_row.state = 'resolved', 'resolving twice is idempotent');

  select count(*) into v_refunds from public.refunds
   where order_id = (select id from t_rec where key = 'late_order');
  perform pg_temp.assert(v_refunds = 1, 'a repeated resolve never creates a second refund');
end;
$$;

do $$
declare v_refunds int; v_failed boolean := false;
begin
  begin
    perform public.record_refund(
      'pi_late', 're_late_1', 1.00, 'duplicate attempt', 'evt_dup', '{}'::jsonb);
  exception when others then v_failed := true; end;

  perform pg_temp.assert(v_failed,
    'a replayed refund on a fully refunded payment is refused rather than over refunding');

  select count(*) into v_refunds from public.refunds
   where order_id = (select id from t_rec where key = 'late_order');
  perform pg_temp.assert(v_refunds = 1,
    'replaying the same provider refund id never refunds twice');

  perform pg_temp.assert(
    (select amount_refunded from public.payments
      where order_id = (select id from t_rec where key = 'late_order'))
      = (select amount from public.payments
          where order_id = (select id from t_rec where key = 'late_order')),
    'the refunded amount never exceeds what was captured');
end;
$$;

do $$
declare v_order_id uuid; v_rec public.payment_reconciliations; v_status public.order_status;
begin
  v_order_id := pg_temp.place_card_order('pi_cancelled');

  perform pg_temp.act_as((select id from t_rec where key = 'admin'));
  perform public.transition_order_status(v_order_id, 'cancelled'::public.order_status, 'customer changed mind');

  perform pg_temp.act_as_system();
  perform public.confirm_payment('pi_cancelled', 'ch_cancelled', 'evt_cancelled', '{}'::jsonb);

  select status into v_status from public.orders where id = v_order_id;
  perform pg_temp.assert(v_status = 'cancelled', 'a late payment never revives a cancelled order');

  select * into v_rec from public.payment_reconciliations where order_id = v_order_id;
  perform pg_temp.assert(v_rec.id is not null, 'a cancelled order also opens a reconciliation');

  perform pg_temp.assert(
    not exists (select 1 from public.ledger_entries
                 where order_id = v_order_id and entry_type = 'restaurant_payout'),
    'a cancelled order never books a restaurant payout');
end;
$$;

do $$
declare v_visible int;
begin
  set local role authenticated;

  perform pg_temp.act_as((select id from t_rec where key = 'customer'));
  select count(*) into v_visible from public.payment_reconciliations;
  perform pg_temp.assert(v_visible >= 1, 'a customer can see the reconciliation for their own order');

  perform pg_temp.act_as((select id from t_rec where key = 'other'));
  select count(*) into v_visible from public.payment_reconciliations;
  perform pg_temp.assert(v_visible = 0, 'an unrelated customer sees no reconciliations');

  reset role;
end;
$$;

do $$
declare v_failed boolean := false;
begin
  set local role authenticated;
  perform pg_temp.act_as((select id from t_rec where key = 'customer'));

  begin
    perform public.claim_payment_reconciliations(10);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a customer cannot claim reconciliation work');

  v_failed := false;
  begin
    perform public.resolve_payment_reconciliation(
      (select id from t_rec where key = 'late_rec'), 're_hack', null, '{}'::jsonb);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a customer cannot resolve a reconciliation');

  v_failed := false;
  begin
    insert into public.payment_reconciliations (payment_id, order_id, kind, amount)
    select p.id, p.order_id, 'refund_unfulfilled_order', 1.00
      from public.payments p limit 1;
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a customer cannot forge a reconciliation');

  reset role;
end;
$$;


do $$
declare v_rec public.payment_reconciliations; v_failed boolean;
begin
  perform pg_temp.act_as_system();
  update public.payment_reconciliations
     set state = 'pending', attempts = 10, next_attempt_at = now(), locked_at = null,
         last_error = 'Stripe said sk_live_abcdef leaked and Authorization: Bearer secret123'
   where id = (select id from t_rec where key = 'late_rec');

  perform pg_temp.act_as((select id from t_rec where key = 'admin'));

  perform pg_temp.assert(
    (select last_error from public.admin_payment_reconciliations(20, 0)
      where id = (select id from t_rec where key = 'late_rec')) not like '%sk_live_abcdef%',
    'the admin list redacts provider keys from the failure description');

  perform pg_temp.assert(
    (select last_error from public.admin_payment_reconciliations(20, 0)
      where id = (select id from t_rec where key = 'late_rec')) not like '%secret123%',
    'the admin list redacts bearer tokens from the failure description');

  perform pg_temp.assert(
    (select currency from public.admin_payment_reconciliations(20, 0)
      where id = (select id from t_rec where key = 'late_rec')) is not null,
    'the admin list reports the currency');

  perform pg_temp.assert(
    (select provider_intent_id from public.admin_payment_reconciliations(20, 0)
      where id = (select id from t_rec where key = 'late_rec')) = 'pi_late',
    'the admin list reports the payment reference');
end;
$$;

do $$
declare v_failed boolean := false; v_rec public.payment_reconciliations; v_audit int;
begin
  perform pg_temp.act_as((select id from t_rec where key = 'customer'));
  begin
    perform public.admin_retry_payment_reconciliation(
      (select id from t_rec where key = 'late_rec'), 'let me try');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a customer cannot retry a refund');

  perform pg_temp.act_as((select id from t_rec where key = 'other'));
  perform pg_temp.assert(
    not exists (select 1 from public.admin_payment_reconciliations(20, 0)),
    'a non admin sees no reconciliations at all');

  perform pg_temp.act_as((select id from t_rec where key = 'admin'));

  v_failed := false;
  begin
    perform public.admin_retry_payment_reconciliation(
      (select id from t_rec where key = 'late_rec'), '   ');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a retry without a reason is refused');

  v_rec := public.admin_retry_payment_reconciliation(
    (select id from t_rec where key = 'late_rec'), 'customer contacted support');
  perform pg_temp.assert(v_rec.state = 'pending', 'an admin retry requeues the refund');
  perform pg_temp.assert(v_rec.attempts = 10, 'an admin retry does not reset the attempt count');

  select count(*) into v_audit from public.admin_actions
   where action = 'retry_payment_reconciliation'
     and subject_id = (select id::text from t_rec where key = 'late_rec');
  perform pg_temp.assert(v_audit = 1, 'an admin retry writes an audit record');
end;
$$;

do $$
declare v_key_before uuid; v_key_after uuid; v_count int;
begin
  perform pg_temp.act_as((select id from t_rec where key = 'admin'));

  select provider_idempotency_key into v_key_before from public.payment_reconciliations
   where id = (select id from t_rec where key = 'late_rec');

  perform public.admin_retry_payment_reconciliation(
    (select id from t_rec where key = 'late_rec'), 'second manual retry');

  select provider_idempotency_key into v_key_after from public.payment_reconciliations
   where id = (select id from t_rec where key = 'late_rec');

  perform pg_temp.assert(v_key_before = v_key_after,
    'a retry preserves the provider idempotency key');

  select count(*) into v_count from public.payment_reconciliations
   where payment_id = (select payment_id from public.payment_reconciliations
                        where id = (select id from t_rec where key = 'late_rec'));
  perform pg_temp.assert(v_count = 1, 'repeated retries never create a duplicate queue record');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  perform pg_temp.act_as_system();
  update public.payment_reconciliations
     set state = 'in_progress', next_attempt_at = now() + interval '5 minutes'
   where id = (select id from t_rec where key = 'late_rec');

  perform pg_temp.act_as((select id from t_rec where key = 'admin'));
  begin
    perform public.admin_retry_payment_reconciliation(
      (select id from t_rec where key = 'late_rec'), 'impatient');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'an admin retry never steals a live worker lease');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  perform pg_temp.act_as_system();
  update public.payment_reconciliations
     set state = 'resolved', resolved_at = now()
   where id = (select id from t_rec where key = 'late_rec');

  perform pg_temp.act_as((select id from t_rec where key = 'admin'));
  begin
    perform public.admin_retry_payment_reconciliation(
      (select id from t_rec where key = 'late_rec'), 'one more time');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a resolved refund can never be retried again');
end;
$$;

do $$
declare v_status text;
begin
  perform pg_temp.act_as_system();

  perform public.record_payment_reconciliation_outcome(
    (select id from t_rec where key = 'late_rec'), 're_pending_1', 'pending', 120);

  select provider_status into v_status from public.payment_reconciliations
   where id = (select id from t_rec where key = 'late_rec');
  perform pg_temp.assert(v_status = 'pending', 'an ambiguous provider outcome is recorded');

  perform pg_temp.assert(
    (select state from public.payment_reconciliations
      where id = (select id from t_rec where key = 'late_rec')) = 'resolved',
    'recording an outcome never reopens a resolved refund');
end;
$$;

rollback;
