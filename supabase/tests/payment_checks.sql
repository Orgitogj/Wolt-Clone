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

create temporary table t_ids (key text primary key, id uuid not null) on commit drop;

insert into auth.users (id, email) values
  (gen_random_uuid(), 'cx@pay.test'),
  (gen_random_uuid(), 'other@pay.test'),
  (gen_random_uuid(), 'mb@pay.test');

insert into t_ids (key, id)
select 'customer', id from auth.users where email = 'cx@pay.test'
union all select 'other', id from auth.users where email = 'other@pay.test'
union all select 'merchant', id from auth.users where email = 'mb@pay.test';

insert into public.restaurants (name, min_order, is_open, latitude, longitude)
values ('Payment Test Kitchen', 0, true, 51.9625, 7.6257);
insert into t_ids (key, id) select 'restaurant', id from public.restaurants where name = 'Payment Test Kitchen';

insert into public.menu_categories (restaurant_id, name)
select id, 'Mains' from t_ids where key = 'restaurant';

insert into public.dishes (restaurant_id, menu_category_id, name, price, is_available)
select r.id, m.id, 'Payment Dish', 20.00, true
  from t_ids r join public.menu_categories m on m.restaurant_id = r.id
 where r.key = 'restaurant';
insert into t_ids (key, id) select 'dish', id from public.dishes where name = 'Payment Dish';

insert into public.restaurant_members (restaurant_id, user_id, role)
select r.id, u.id, 'owner' from t_ids r, t_ids u where r.key = 'restaurant' and u.key = 'merchant';

update public.platform_settings set card_payments_enabled = false;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'customer')); end $$;
set local role authenticated;

do $$
declare v_failed boolean := false;
begin
  begin
    perform public.create_order(
      (select id from t_ids where key = 'restaurant'),
      jsonb_build_array(jsonb_build_object('dish_id', (select id from t_ids where key = 'dish'),
                                           'quantity', 1, 'addon_ids', '[]'::jsonb)),
      'pickup', null, null, 0, 'card', false, false, gen_random_uuid());
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'card orders are refused while card payments are disabled');
end;
$$;

do $$
declare v_order public.orders;
begin
  v_order := public.create_order(
    (select id from t_ids where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object('dish_id', (select id from t_ids where key = 'dish'),
                                         'quantity', 1, 'addon_ids', '[]'::jsonb)),
    'pickup', null, null, 0, 'cash', false, false, gen_random_uuid());
  perform pg_temp.assert(v_order.status = 'placed', 'a cash order is placed immediately');
  perform pg_temp.assert(
    (select count(*) from public.payments where order_id = v_order.id) = 0,
    'a cash order creates no payment record');
  perform pg_temp.assert(
    (select count(*) from public.ledger_entries where order_id = v_order.id) = 3,
    'a cash order posts the ledger immediately');
end;
$$;
reset role;

update public.platform_settings set card_payments_enabled = true, commission_rate = 0.1500;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'customer')); end $$;
set local role authenticated;
do $$
declare v_order public.orders;
begin
  v_order := public.create_order(
    (select id from t_ids where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object('dish_id', (select id from t_ids where key = 'dish'),
                                         'quantity', 2, 'addon_ids', '[]'::jsonb)),
    'pickup', null, null, 3.00, 'card', false, false, gen_random_uuid());

  insert into t_ids (key, id) values ('order', v_order.id);

  perform pg_temp.assert(v_order.status = 'pending_payment',
    'a card order waits for payment before it is placed');
  perform pg_temp.assert(v_order.subtotal = 40.00, 'the server prices the card order');
  perform pg_temp.assert(
    (select count(*) from public.ledger_entries where order_id = v_order.id) = 0,
    'nothing is posted to the ledger before payment succeeds');
  perform pg_temp.assert(
    (select amount from public.payments where order_id = v_order.id) = v_order.total,
    'the payment record matches the stored order total');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'merchant')); end $$;
set local role authenticated;
do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.orders
      where id = (select id from t_ids where key = 'order')
        and status in ('placed','accepted','preparing','ready_for_pickup')) = 0,
    'the restaurant does not see an unpaid order as actionable');
end;
$$;
reset role;

update public.payments set provider_intent_id = 'pi_test_123'
 where order_id = (select id from t_ids where key = 'order');

do $$
declare
  v_payment public.payments;
  v_order public.orders;
  v_commission numeric;
begin
  v_payment := public.confirm_payment('pi_test_123', 'ch_test_123', 'evt_1', '{}'::jsonb);
  perform pg_temp.assert(v_payment.status = 'succeeded', 'the webhook marks the payment succeeded');

  select * into v_order from public.orders where id = (select id from t_ids where key = 'order');
  perform pg_temp.assert(v_order.status = 'placed',
    'a confirmed payment places the order');

  perform pg_temp.assert(
    (select count(*) from public.order_status_history
      where order_id = v_order.id and to_status = 'placed' and actor_role = 'system') = 1,
    'the placement is attributed to the system, not the customer');

  v_commission := round(v_order.subtotal * 0.15, 2);
  perform pg_temp.assert(
    (select amount from public.ledger_entries
      where order_id = v_order.id and entry_type = 'charge') = v_order.total,
    'the ledger records the full charge');
  perform pg_temp.assert(
    (select amount from public.ledger_entries
      where order_id = v_order.id and entry_type = 'restaurant_payout')
      = -(v_order.subtotal - v_commission),
    'the restaurant payout is subtotal minus commission');
  perform pg_temp.assert(
    (select amount from public.ledger_entries
      where order_id = v_order.id and entry_type = 'platform_commission') = v_commission,
    'the platform commission is recorded');
end;
$$;

do $$
declare v_payment public.payments;
begin
  v_payment := public.confirm_payment('pi_test_123', 'ch_test_123', 'evt_1', '{}'::jsonb);
  perform pg_temp.assert(v_payment.status = 'succeeded', 'replaying a webhook event is harmless');
  perform pg_temp.assert(
    (select count(*) from public.payment_transactions
      where provider_event_id = 'evt_1') = 1,
    'a replayed webhook event is only recorded once');
  perform pg_temp.assert(
    (select count(*) from public.ledger_entries
      where order_id = (select id from t_ids where key = 'order')) = 3,
    'a replayed webhook does not double post the ledger');
end;
$$;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'other')); end $$;
set local role authenticated;
do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.payments) = 0,
    'a customer cannot read another customer payment');
  perform pg_temp.assert(
    (select count(*) from public.ledger_entries) = 0,
    'a customer cannot read another order ledger');
  perform pg_temp.assert(
    (select count(*) from public.order_financials) = 0,
    'a customer cannot read another order financials');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'merchant')); end $$;
set local role authenticated;
do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.order_financials
      where order_id = (select id from t_ids where key = 'order')) = 1,
    'the restaurant can read financials for its own order');
  perform pg_temp.assert(
    (select restaurant_payout from public.order_financials
      where order_id = (select id from t_ids where key = 'order')) = 34.00,
    'the restaurant sees its payout on a 40.00 subtotal at 15 percent');
end;
$$;
reset role;

do $$
declare v_refund public.refunds;
begin
  v_refund := public.record_refund('pi_test_123', 're_test_1', 10.00, 'Missing item', 'evt_2', '{}'::jsonb);
  perform pg_temp.assert(v_refund.amount = 10.00, 'a partial refund is recorded');
  perform pg_temp.assert(
    (select amount_refunded from public.payments where provider_intent_id = 'pi_test_123') = 10.00,
    'the refunded amount accumulates on the payment');
  perform pg_temp.assert(
    (select status from public.payments where provider_intent_id = 'pi_test_123') = 'succeeded',
    'a partial refund leaves the payment succeeded');
  perform pg_temp.assert(
    (select amount from public.ledger_entries
      where order_id = (select id from t_ids where key = 'order') and entry_type = 'refund') = -10.00,
    'the refund is posted to the ledger');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    perform public.record_refund('pi_test_123', 're_test_2', 999.00, 'Too much', 'evt_3', '{}'::jsonb);
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a refund cannot exceed the remaining balance');
end;
$$;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'customer')); end $$;
set local role authenticated;
do $$
declare v_order public.orders;
begin
  v_order := public.create_order(
    (select id from t_ids where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object('dish_id', (select id from t_ids where key = 'dish'),
                                         'quantity', 1, 'addon_ids', '[]'::jsonb)),
    'pickup', null, null, 0, 'card', false, false, gen_random_uuid());
  insert into t_ids (key, id) values ('failed_order', v_order.id);
end;
$$;
reset role;

update public.payments set provider_intent_id = 'pi_test_fail'
 where order_id = (select id from t_ids where key = 'failed_order');

do $$
declare v_payment public.payments;
begin
  v_payment := public.fail_payment('pi_test_fail', 'Card declined', 'evt_4', '{}'::jsonb);
  perform pg_temp.assert(v_payment.status = 'failed', 'a declined card fails the payment');
  perform pg_temp.assert(
    (select status from public.orders where id = (select id from t_ids where key = 'failed_order'))
      = 'payment_failed',
    'a declined card fails the order');
  perform pg_temp.assert(
    (select count(*) from public.ledger_entries
      where order_id = (select id from t_ids where key = 'failed_order')) = 0,
    'a failed payment posts nothing to the ledger');
end;
$$;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'customer')); end $$;
set local role authenticated;
do $$
declare v_order public.orders;
begin
  v_order := public.create_order(
    (select id from t_ids where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object('dish_id', (select id from t_ids where key = 'dish'),
                                         'quantity', 1, 'addon_ids', '[]'::jsonb)),
    'pickup', null, null, 0, 'card', false, false, gen_random_uuid());
  insert into t_ids (key, id) values ('stale_order', v_order.id);
end;
$$;
reset role;

update public.orders set created_at = now() - interval '2 hours'
 where id = (select id from t_ids where key = 'stale_order');

do $$
declare v_expired int;
begin
  v_expired := public.expire_unpaid_orders();
  perform pg_temp.assert(v_expired >= 1, 'unpaid orders expire after the hold window');
  perform pg_temp.assert(
    (select status from public.orders where id = (select id from t_ids where key = 'stale_order'))
      = 'payment_failed',
    'the expired order is marked payment_failed');
end;
$$;

rollback;
