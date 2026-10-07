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

create temporary table t_promo (key text primary key, id uuid not null) on commit drop;
grant all on t_promo to anon, authenticated;

create or replace function pg_temp.place_order(p_code text default null, p_quantity int default 2)
returns public.orders language plpgsql as $$
begin
  return public.create_order(
    (select id from t_promo where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object(
      'dish_id', (select id from t_promo where key = 'dish'),
      'quantity', p_quantity, 'addon_ids', '[]'::jsonb)),
    'delivery', (select id from t_promo where key = 'address'), null, 0, 'cash', false, false,
    gen_random_uuid(), p_code);
end;
$$;

insert into auth.users (id, email)
values
  (gen_random_uuid(), 'promo-a@test.local'),
  (gen_random_uuid(), 'promo-b@test.local'),
  (gen_random_uuid(), 'promo-admin@test.local');

insert into t_promo (key, id)
select 'customer_a', id from auth.users where email = 'promo-a@test.local'
union all select 'customer_b', id from auth.users where email = 'promo-b@test.local'
union all select 'admin', id from auth.users where email = 'promo-admin@test.local';

update public.profiles set role = 'admin' where id = (select id from t_promo where key = 'admin');

insert into public.restaurants (name, min_order, is_open, latitude, longitude)
values ('Promo Kitchen', 0, true, 51.9625, 7.6257);
insert into t_promo (key, id) select 'restaurant', id from public.restaurants where name = 'Promo Kitchen';

insert into public.restaurants (name, min_order, is_open, latitude, longitude)
values ('Other Kitchen', 0, true, 51.9625, 7.6257);
insert into t_promo (key, id) select 'other_restaurant', id from public.restaurants where name = 'Other Kitchen';

insert into public.menu_categories (restaurant_id, name)
select id, 'Mains' from t_promo where key = 'restaurant';

insert into public.dishes (restaurant_id, menu_category_id, name, price, is_available)
select r.id, m.id, 'Promo Dish', 10.00, true
  from t_promo r join public.menu_categories m on m.restaurant_id = r.id
 where r.key = 'restaurant';
insert into t_promo (key, id) select 'dish', id from public.dishes where name = 'Promo Dish';

insert into public.addresses (user_id, label, address_line, latitude, longitude)
select id, 'Home', 'Promoweg 1', 51.9650, 7.6300 from t_promo where key = 'customer_a';
insert into t_promo (key, id) select 'address', id from public.addresses where address_line = 'Promoweg 1';

insert into public.addresses (user_id, label, address_line, latitude, longitude)
select id, 'Home', 'Promoweg 2', 51.9650, 7.6300 from t_promo where key = 'customer_b';
insert into t_promo (key, id) select 'address_b', id from public.addresses where address_line = 'Promoweg 2';

do $$
declare v_promo public.promotions;
begin
  perform pg_temp.act_as((select id from t_promo where key = 'admin'));

  v_promo := public.admin_save_promotion(
    null, 'save10', '10 percent off', 'percentage', 10, null, 0, null, null, null, null, 5, true);
  insert into t_promo (key, id) values ('percentage', v_promo.id);
  perform pg_temp.assert(v_promo.code = 'SAVE10', 'a promo code is stored upper case');

  v_promo := public.admin_save_promotion(
    null, 'FLAT5', '5 off', 'fixed', 5, null, 15, null, null, null, null, 5, true);
  insert into t_promo (key, id) values ('fixed', v_promo.id);

  v_promo := public.admin_save_promotion(
    null, 'CAPPED', 'half off up to 2', 'percentage', 50, 2, 0, null, null, null, null, 5, true);
  insert into t_promo (key, id) values ('capped', v_promo.id);

  v_promo := public.admin_save_promotion(
    null, 'ONLYHERE', 'restaurant only', 'fixed', 3, null, 0,
    (select id from t_promo where key = 'other_restaurant'), null, null, null, 5, true);
  insert into t_promo (key, id) values ('restricted', v_promo.id);

  v_promo := public.admin_save_promotion(
    null, 'EXPIRED', 'past', 'fixed', 3, null, 0, null,
    now() - interval '10 days', now() - interval '1 day', null, 5, true);
  insert into t_promo (key, id) values ('expired', v_promo.id);

  v_promo := public.admin_save_promotion(
    null, 'FUTURE', 'later', 'fixed', 3, null, 0, null,
    now() + interval '1 day', now() + interval '10 days', null, 5, true);
  insert into t_promo (key, id) values ('future', v_promo.id);

  v_promo := public.admin_save_promotion(
    null, 'ONEONLY', 'global cap', 'fixed', 2, null, 0, null, null, null, 1, 5, true);
  insert into t_promo (key, id) values ('global_cap', v_promo.id);

  v_promo := public.admin_save_promotion(
    null, 'ONCEPER', 'per customer', 'fixed', 2, null, 0, null, null, null, null, 1, true);
  insert into t_promo (key, id) values ('per_customer', v_promo.id);

  v_promo := public.admin_save_promotion(
    null, 'DISABLED', 'off', 'fixed', 2, null, 0, null, null, null, null, 5, false);
  insert into t_promo (key, id) values ('disabled', v_promo.id);

  v_promo := public.admin_save_promotion(
    null, 'HUGE', 'bigger than basket', 'fixed', 500, null, 0, null, null, null, null, 5, true);
  insert into t_promo (key, id) values ('huge', v_promo.id);
end;
$$;

do $$
declare v_failed boolean := false;
begin
  perform pg_temp.act_as((select id from t_promo where key = 'customer_a'));
  begin
    perform public.admin_save_promotion(
      null, 'HACK', 'mine', 'fixed', 100, null, 0, null, null, null, null, 5, true);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a customer cannot create a promotion');
end;
$$;

do $$
declare v_valid boolean; v_reason text; v_discount numeric;
begin
  perform pg_temp.act_as((select id from t_promo where key = 'customer_a'));

  select valid, reason, discount_amount into v_valid, v_reason, v_discount
    from public.evaluate_promotion('SAVE10', (select id from t_promo where key = 'restaurant'), 20);
  perform pg_temp.assert(v_valid and v_discount = 2.00, 'a percentage discount is 10 percent of the subtotal');

  select valid, reason, discount_amount into v_valid, v_reason, v_discount
    from public.evaluate_promotion('save10', (select id from t_promo where key = 'restaurant'), 20);
  perform pg_temp.assert(v_valid, 'promo codes are case insensitive');

  select valid, reason, discount_amount into v_valid, v_reason, v_discount
    from public.evaluate_promotion('CAPPED', (select id from t_promo where key = 'restaurant'), 20);
  perform pg_temp.assert(v_discount = 2.00, 'a percentage discount is capped by the maximum');

  select valid, reason, discount_amount into v_valid, v_reason, v_discount
    from public.evaluate_promotion('HUGE', (select id from t_promo where key = 'restaurant'), 20);
  perform pg_temp.assert(v_discount = 20.00, 'a discount never exceeds the eligible subtotal');

  select valid, reason into v_valid, v_reason
    from public.evaluate_promotion('FLAT5', (select id from t_promo where key = 'restaurant'), 10);
  perform pg_temp.assert(not v_valid and v_reason = 'below_minimum',
    'a basket under the minimum is refused');

  select valid, reason, discount_amount into v_valid, v_reason, v_discount
    from public.evaluate_promotion('FLAT5', (select id from t_promo where key = 'restaurant'), 15);
  perform pg_temp.assert(v_valid and v_discount = 5.00, 'the minimum boundary is inclusive');

  select valid, reason into v_valid, v_reason
    from public.evaluate_promotion('EXPIRED', (select id from t_promo where key = 'restaurant'), 20);
  perform pg_temp.assert(not v_valid and v_reason = 'expired', 'an expired code is refused');

  select valid, reason into v_valid, v_reason
    from public.evaluate_promotion('FUTURE', (select id from t_promo where key = 'restaurant'), 20);
  perform pg_temp.assert(not v_valid and v_reason = 'not_started', 'a future code is refused');

  select valid, reason into v_valid, v_reason
    from public.evaluate_promotion('ONLYHERE', (select id from t_promo where key = 'restaurant'), 20);
  perform pg_temp.assert(not v_valid and v_reason = 'wrong_restaurant',
    'a restaurant restricted code is refused elsewhere');

  select valid, reason into v_valid, v_reason
    from public.evaluate_promotion('DISABLED', (select id from t_promo where key = 'restaurant'), 20);
  perform pg_temp.assert(not v_valid and v_reason = 'not_found', 'a deactivated code is refused');

  select valid, reason into v_valid, v_reason
    from public.evaluate_promotion('NOSUCHCODE', (select id from t_promo where key = 'restaurant'), 20);
  perform pg_temp.assert(not v_valid and v_reason = 'not_found', 'an unknown code is refused');

  select valid, reason into v_valid, v_reason
    from public.evaluate_promotion('   ', (select id from t_promo where key = 'restaurant'), 20);
  perform pg_temp.assert(not v_valid and v_reason = 'not_found', 'a blank code is refused');
end;
$$;

do $$
declare v_order public.orders;
begin
  perform pg_temp.act_as((select id from t_promo where key = 'customer_a'));
  v_order := pg_temp.place_order('SAVE10');

  perform pg_temp.assert(v_order.subtotal = 20.00, 'the subtotal is still the full basket');
  perform pg_temp.assert(v_order.discount_amount = 2.00, 'the discount is stored on the order');
  perform pg_temp.assert(v_order.promo_code = 'SAVE10', 'the applied code is stored on the order');
  perform pg_temp.assert(
    v_order.total = v_order.subtotal + v_order.service_fee + v_order.delivery_fee
                    + v_order.tip_amount - v_order.discount_amount,
    'the total subtracts the discount from the full order');
  perform pg_temp.assert(
    v_order.promotion_snapshot ->> 'code' = 'SAVE10',
    'the order keeps a promotion snapshot');
  perform pg_temp.assert(
    (v_order.promotion_snapshot ->> 'discount_amount')::numeric = 2.00,
    'the snapshot records the discount that was applied');

  insert into t_promo (key, id) values ('order_a', v_order.id);
end;
$$;

do $$
declare v_count int; v_state text;
begin
  select count(*), min(state) into v_count, v_state
    from public.promotion_redemptions
   where order_id = (select id from t_promo where key = 'order_a');
  perform pg_temp.assert(v_count = 1, 'placing an order reserves one redemption');
  perform pg_temp.assert(v_state = 'reserved', 'a new redemption starts reserved');
end;
$$;

do $$
declare v_charge numeric; v_payout numeric; v_commission numeric; v_order public.orders;
begin
  select * into v_order from public.orders where id = (select id from t_promo where key = 'order_a');

  select amount into v_charge from public.ledger_entries
   where order_id = v_order.id and entry_type = 'charge';
  select amount into v_payout from public.ledger_entries
   where order_id = v_order.id and entry_type = 'restaurant_payout';
  select amount into v_commission from public.ledger_entries
   where order_id = v_order.id and entry_type = 'platform_commission';

  perform pg_temp.assert(v_charge = v_order.total,
    'the customer is charged the discounted total');
  perform pg_temp.assert(v_payout = -(v_order.subtotal - v_commission),
    'the restaurant is settled on the full subtotal, so the platform funds the discount');
  perform pg_temp.assert(
    (select platform_net from public.order_financials where order_id = v_order.id)
      = v_charge + v_payout,
    'the discount is counted once in the platform net');
end;
$$;

do $$
declare v_first public.orders; v_second public.orders; v_key uuid := gen_random_uuid(); v_count int;
begin
  perform pg_temp.act_as((select id from t_promo where key = 'customer_a'));

  v_first := public.create_order(
    (select id from t_promo where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object(
      'dish_id', (select id from t_promo where key = 'dish'), 'quantity', 2, 'addon_ids', '[]'::jsonb)),
    'delivery', (select id from t_promo where key = 'address'), null, 0, 'cash', false, false,
    v_key, 'CAPPED');

  v_second := public.create_order(
    (select id from t_promo where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object(
      'dish_id', (select id from t_promo where key = 'dish'), 'quantity', 2, 'addon_ids', '[]'::jsonb)),
    'delivery', (select id from t_promo where key = 'address'), null, 0, 'cash', false, false,
    v_key, 'CAPPED');

  perform pg_temp.assert(v_first.id = v_second.id, 'a repeated submission returns the same order');

  select count(*) into v_count from public.promotion_redemptions
   where promotion_id = (select id from t_promo where key = 'capped');
  perform pg_temp.assert(v_count = 1, 'a repeated submission never redeems the code twice');
end;
$$;

do $$
declare v_order public.orders; v_failed boolean := false;
begin
  perform pg_temp.act_as((select id from t_promo where key = 'customer_a'));
  v_order := pg_temp.place_order('ONEONLY');
  insert into t_promo (key, id) values ('global_cap_order', v_order.id);

  perform pg_temp.act_as((select id from t_promo where key = 'customer_b'));
  begin
    perform public.create_order(
      (select id from t_promo where key = 'restaurant'),
      jsonb_build_array(jsonb_build_object(
        'dish_id', (select id from t_promo where key = 'dish'), 'quantity', 2, 'addon_ids', '[]'::jsonb)),
      'delivery', (select id from t_promo where key = 'address_b'), null, 0, 'cash', false, false,
      gen_random_uuid(), 'ONEONLY');
  exception when others then v_failed := true; end;

  perform pg_temp.assert(v_failed, 'the global redemption cap blocks a second customer');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  perform pg_temp.act_as((select id from t_promo where key = 'customer_a'));
  perform pg_temp.place_order('ONCEPER');

  begin
    perform pg_temp.place_order('ONCEPER');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'the per customer cap blocks a second use');

  perform pg_temp.act_as((select id from t_promo where key = 'customer_b'));
  perform public.create_order(
    (select id from t_promo where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object(
      'dish_id', (select id from t_promo where key = 'dish'), 'quantity', 2, 'addon_ids', '[]'::jsonb)),
    'delivery', (select id from t_promo where key = 'address_b'), null, 0, 'cash', false, false,
    gen_random_uuid(), 'ONCEPER');
  perform pg_temp.assert(true, 'a different customer can still use a per customer code');
end;
$$;

do $$
declare v_state text; v_order_id uuid;
begin
  v_order_id := (select id from t_promo where key = 'global_cap_order');

  perform pg_temp.act_as((select id from t_promo where key = 'admin'));
  perform public.transition_order_status(v_order_id, 'cancelled'::public.order_status, 'Testing release');

  select state into v_state from public.promotion_redemptions where order_id = v_order_id;
  perform pg_temp.assert(v_state = 'released', 'cancelling an order releases its redemption');
end;
$$;

do $$
declare v_valid boolean; v_order public.orders;
begin
  perform pg_temp.act_as((select id from t_promo where key = 'customer_b'));
  select valid into v_valid
    from public.evaluate_promotion('ONEONLY', (select id from t_promo where key = 'restaurant'), 20);
  perform pg_temp.assert(v_valid, 'a released redemption frees the global cap again');
end;
$$;

do $$
declare v_order_id uuid; v_state text;
begin
  v_order_id := (select id from t_promo where key = 'order_a');

  perform pg_temp.act_as((select id from t_promo where key = 'admin'));
  perform public.transition_order_status(v_order_id, 'accepted'::public.order_status);
  perform public.transition_order_status(v_order_id, 'preparing'::public.order_status);
  perform public.transition_order_status(v_order_id, 'ready_for_pickup'::public.order_status);
  perform public.transition_order_status(v_order_id, 'delivered'::public.order_status);

  select state into v_state from public.promotion_redemptions where order_id = v_order_id;
  perform pg_temp.assert(v_state = 'consumed', 'delivering an order consumes its redemption');
end;
$$;

do $$
declare v_order public.orders; v_snapshot jsonb;
begin
  perform pg_temp.act_as((select id from t_promo where key = 'admin'));
  perform public.admin_save_promotion(
    (select id from t_promo where key = 'percentage'), 'SAVE10', 'now 50 percent',
    'percentage', 50, null, 0, null, null, null, null, 5, true);

  select promotion_snapshot into v_snapshot from public.orders
   where id = (select id from t_promo where key = 'order_a');
  perform pg_temp.assert((v_snapshot ->> 'discount_value')::numeric = 10,
    'editing a promotion never rewrites a historical order');

  select * into v_order from public.orders where id = (select id from t_promo where key = 'order_a');
  perform pg_temp.assert(v_order.discount_amount = 2.00,
    'a past order keeps the discount it was given');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  set local role authenticated;
  perform pg_temp.act_as((select id from t_promo where key = 'customer_a'));

  begin
    insert into public.promotions (code, discount_type, discount_value)
    values ('SELFMADE', 'fixed', 100);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a customer cannot insert a promotion');

  v_failed := false;
  begin
    update public.promotions set discount_value = 99
     where id = (select id from t_promo where key = 'percentage');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a customer cannot change a promotion');

  v_failed := false;
  begin
    insert into public.promotion_redemptions (promotion_id, order_id, user_id, discount_amount)
    values ((select id from t_promo where key = 'percentage'),
            (select id from t_promo where key = 'order_a'),
            (select id from t_promo where key = 'customer_a'), 100);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a customer cannot forge a redemption');

  reset role;
end;
$$;

do $$
declare v_rows int;
begin
  set local role authenticated;
  perform pg_temp.act_as((select id from t_promo where key = 'customer_a'));

  select count(*) into v_rows from public.promotions where code = 'DISABLED';
  perform pg_temp.assert(v_rows = 0, 'a deactivated promotion is not readable by customers');

  select count(*) into v_rows from public.promotions where code = 'EXPIRED';
  perform pg_temp.assert(v_rows = 0, 'an expired promotion is not readable by customers');

  select count(*) into v_rows from public.promotion_redemptions
   where user_id = (select id from t_promo where key = 'customer_b');
  perform pg_temp.assert(v_rows = 0, 'a customer cannot read another customer redemptions');

  reset role;
end;
$$;

do $$
declare v_rows int;
begin
  perform pg_temp.act_as((select id from t_promo where key = 'customer_a'));
  select count(*) into v_rows from public.active_promotions(null);
  perform pg_temp.assert(v_rows > 0, 'the offers list returns active promotions');

  perform pg_temp.assert(
    not exists (select 1 from public.active_promotions(null) where code in ('EXPIRED', 'FUTURE', 'DISABLED')),
    'the offers list never shows expired, future or disabled promotions');

  perform pg_temp.assert(
    not exists (
      select 1 from public.active_promotions((select id from t_promo where key = 'restaurant'))
       where code = 'ONLYHERE'
    ),
    'a restaurant restricted offer is hidden for other restaurants');
end;
$$;

do $$
declare v_order public.orders;
begin
  perform pg_temp.act_as((select id from t_promo where key = 'customer_b'));
  v_order := public.create_order(
    (select id from t_promo where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object(
      'dish_id', (select id from t_promo where key = 'dish'), 'quantity', 2, 'addon_ids', '[]'::jsonb)),
    'delivery', (select id from t_promo where key = 'address_b'), null, 0, 'cash', false, false,
    gen_random_uuid(), null);

  perform pg_temp.assert(v_order.discount_amount = 0, 'an order without a code has no discount');
  perform pg_temp.assert(v_order.promotion_id is null, 'an order without a code has no promotion');
  perform pg_temp.assert(
    v_order.total = v_order.subtotal + v_order.service_fee + v_order.delivery_fee + v_order.tip_amount,
    'an undiscounted total is unchanged');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  perform pg_temp.act_as((select id from t_promo where key = 'customer_b'));
  begin
    perform public.create_order(
      (select id from t_promo where key = 'restaurant'),
      jsonb_build_array(jsonb_build_object(
        'dish_id', (select id from t_promo where key = 'dish'), 'quantity', 2, 'addon_ids', '[]'::jsonb)),
      'delivery', (select id from t_promo where key = 'address_b'), null, 0, 'cash', false, false,
      gen_random_uuid(), 'EXPIRED');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'checkout refuses an expired code even if the client sends it');
end;
$$;

do $$
declare v_order public.orders;
begin
  perform pg_temp.act_as((select id from t_promo where key = 'customer_b'));
  v_order := public.create_order(
    (select id from t_promo where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object(
      'dish_id', (select id from t_promo where key = 'dish'), 'quantity', 2, 'addon_ids', '[]'::jsonb)),
    'delivery', (select id from t_promo where key = 'address_b'), null, 0, 'cash', false, false,
    gen_random_uuid(), 'HUGE');

  perform pg_temp.assert(v_order.discount_amount = v_order.subtotal,
    'a discount larger than the basket is clamped to the subtotal');
  perform pg_temp.assert(
    v_order.total = v_order.service_fee + v_order.delivery_fee + v_order.tip_amount,
    'fees and tip are never discounted away');
  perform pg_temp.assert(v_order.total >= 0, 'a total is never negative');
end;
$$;


do $$
declare v_failed boolean; v_promo public.promotions;
begin
  perform pg_temp.act_as((select id from t_promo where key = 'admin'));

  v_failed := false;
  begin
    perform public.admin_save_promotion(
      null, 'BADWINDOW', 'x', 'fixed', 2, null, 0, null,
      now() + interval '2 days', now() + interval '1 day', null, 1, true);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'an end before the start is refused');

  v_failed := false;
  begin
    perform public.admin_save_promotion(
      null, 'SAMEINSTANT', 'x', 'fixed', 2, null, 0, null,
      '2026-06-01T10:00:00Z'::timestamptz, '2026-06-01T10:00:00Z'::timestamptz, null, 1, true);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'an end equal to the start is refused');

  v_failed := false;
  begin
    perform public.admin_save_promotion(
      null, 'TOOBIG', 'x', 'percentage', 150, null, 0, null, null, null, null, 1, true);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a percentage above 100 is refused');

  v_failed := false;
  begin
    perform public.admin_save_promotion(
      null, 'ZERO', 'x', 'fixed', 0, null, 0, null, null, null, null, 1, true);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a zero discount is refused');

  v_failed := false;
  begin
    perform public.admin_save_promotion(
      null, 'NEGMIN', 'x', 'fixed', 2, null, -5, null, null, null, null, 1, true);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a negative minimum basket is refused');

  v_failed := false;
  begin
    perform public.admin_save_promotion(
      null, 'ZEROUSES', 'x', 'fixed', 2, null, 0, null, null, null, 0, 1, true);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a zero total use cap is refused');

  v_failed := false;
  begin
    perform public.admin_save_promotion(
      null, 'GHOSTVENUE', 'x', 'fixed', 2, null, 0,
      '00000000-0000-4000-8000-000000000000'::uuid, null, null, null, 1, true);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a promotion for an unknown restaurant is refused');

  v_promo := public.admin_save_promotion(
    null, 'GOODWINDOW', 'x', 'fixed', 2, null, 0, null,
    '2026-06-01T10:00:00Z'::timestamptz, '2026-06-02T10:00:00Z'::timestamptz, null, 1, true);
  perform pg_temp.assert(
    v_promo.starts_at = '2026-06-01T10:00:00Z'::timestamptz,
    'a valid window is stored as the given instant');
  insert into t_promo (key, id) values ('windowed', v_promo.id);
end;
$$;

do $$
declare v_promo public.promotions;
begin
  perform pg_temp.act_as((select id from t_promo where key = 'admin'));

  v_promo := public.admin_save_promotion(
    (select id from t_promo where key = 'windowed'), 'GOODWINDOW', 'edited', 'fixed', 3, null, 5,
    (select id from t_promo where key = 'restaurant'),
    '2026-07-01T08:00:00Z'::timestamptz, '2026-07-05T08:00:00Z'::timestamptz, 10, 2, false);

  perform pg_temp.assert(v_promo.description = 'edited', 'editing updates the description');
  perform pg_temp.assert(v_promo.discount_value = 3, 'editing updates the discount');
  perform pg_temp.assert(v_promo.min_subtotal = 5, 'editing updates the minimum basket');
  perform pg_temp.assert(
    v_promo.restaurant_id = (select id from t_promo where key = 'restaurant'),
    'editing can restrict a promotion to a restaurant');
  perform pg_temp.assert(
    v_promo.starts_at = '2026-07-01T08:00:00Z'::timestamptz,
    'editing updates the start instant');
  perform pg_temp.assert(
    v_promo.ends_at = '2026-07-05T08:00:00Z'::timestamptz,
    'editing updates the end instant');
  perform pg_temp.assert(v_promo.max_redemptions = 10, 'editing updates the global cap');
  perform pg_temp.assert(v_promo.max_per_customer = 2, 'editing updates the per customer cap');
  perform pg_temp.assert(v_promo.is_active = false, 'editing can deactivate a promotion');

  v_promo := public.admin_save_promotion(
    (select id from t_promo where key = 'windowed'), 'GOODWINDOW', 'edited', 'fixed', 3, null, 5,
    null, null, null, 10, 2, true);
  perform pg_temp.assert(v_promo.restaurant_id is null,
    'editing can widen a promotion back to all restaurants');
  perform pg_temp.assert(v_promo.starts_at is null, 'editing can clear the schedule');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  perform pg_temp.act_as((select id from t_promo where key = 'customer_a'));
  begin
    perform public.admin_set_promotion_active(
      (select id from t_promo where key = 'windowed'), false);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a customer cannot deactivate a promotion');

  v_failed := false;
  begin
    perform public.admin_save_promotion(
      (select id from t_promo where key = 'windowed'), 'HIJACK', 'x', 'fixed', 99,
      null, 0, null, null, null, null, 1, true);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a customer cannot edit an existing promotion');
end;
$$;

rollback;
