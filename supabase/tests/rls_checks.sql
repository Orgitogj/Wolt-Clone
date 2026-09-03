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

create temporary table t_ids (
  key text primary key,
  id uuid not null
) on commit drop;
grant all on t_ids to authenticated;

insert into auth.users (id, email)
values
  (gen_random_uuid(), 'customer-a@test.local'),
  (gen_random_uuid(), 'customer-c@test.local'),
  (gen_random_uuid(), 'merchant-b@test.local');

insert into t_ids (key, id)
select 'customer_a', id from auth.users where email = 'customer-a@test.local'
union all
select 'customer_c', id from auth.users where email = 'customer-c@test.local'
union all
select 'merchant_b', id from auth.users where email = 'merchant-b@test.local';

insert into public.restaurants (name, min_order, is_open, latitude, longitude)
values ('RLS Test Kitchen', 0, true, 51.9625, 7.6257);
insert into t_ids (key, id)
select 'restaurant', id from public.restaurants where name = 'RLS Test Kitchen';

insert into public.menu_categories (restaurant_id, name)
select id, 'Mains' from t_ids where key = 'restaurant';

insert into public.dishes (restaurant_id, menu_category_id, name, price, is_available)
select r.id, m.id, 'Test Dish', 10.00, true
  from t_ids r
  join public.menu_categories m on m.restaurant_id = r.id
 where r.key = 'restaurant';
insert into t_ids (key, id)
select 'dish', id from public.dishes where name = 'Test Dish';

insert into public.addresses (user_id, label, address_line, latitude, longitude)
select id, 'Home', 'Testweg 1', 51.9650, 7.6300 from t_ids where key = 'customer_a';
insert into t_ids (key, id)
select 'address', id from public.addresses where address_line = 'Testweg 1';

insert into public.restaurant_members (restaurant_id, user_id, role)
select r.id, u.id, 'owner' from t_ids r, t_ids u
 where r.key = 'restaurant' and u.key = 'merchant_b';

do $$
declare v_a uuid;
begin
  select id into v_a from t_ids where key = 'customer_a';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated', 'is_anonymous', false)::text, true);
end;
$$;
set local role authenticated;

do $$
declare
  v_order public.orders;
  v_restaurant uuid;
  v_dish uuid;
  v_address uuid;
  v_key uuid := gen_random_uuid();
  v_second public.orders;
begin
  select id into v_restaurant from t_ids where key = 'restaurant';
  select id into v_dish from t_ids where key = 'dish';
  select id into v_address from t_ids where key = 'address';

  v_order := public.create_order(
    v_restaurant,
    jsonb_build_array(jsonb_build_object('dish_id', v_dish, 'quantity', 2, 'addon_ids', '[]'::jsonb)),
    'delivery', v_address, null, 1.00, 'cash', false, false, v_key
  );

  perform pg_temp.assert(v_order.subtotal = 20.00, 'server prices the basket (2 x 10.00)');
  perform pg_temp.assert(v_order.service_fee > 0, 'service fee comes from platform_settings');
  perform pg_temp.assert(v_order.delivery_fee > 0, 'delivery fee charged for delivery orders');
  perform pg_temp.assert(
    v_order.total = v_order.subtotal + v_order.service_fee + v_order.delivery_fee + v_order.tip_amount,
    'total is the sum of its parts');
  perform pg_temp.assert(v_order.status = 'placed', 'new order starts at placed');

  v_second := public.create_order(
    v_restaurant,
    jsonb_build_array(jsonb_build_object('dish_id', v_dish, 'quantity', 2, 'addon_ids', '[]'::jsonb)),
    'delivery', v_address, null, 1.00, 'cash', false, false, v_key
  );
  perform pg_temp.assert(v_second.id = v_order.id, 'idempotency key returns the same order');

  perform pg_temp.assert(
    (select count(*) from public.order_status_history where order_id = v_order.id) = 1,
    'order creation writes one history row');

  insert into t_ids (key, id) values ('order', v_order.id);
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.orders (user_id, restaurant_id, delivery_mode, subtotal, total)
    select id, (select id from t_ids where key = 'restaurant'), 'pickup', 0.01, 0.01
      from t_ids where key = 'customer_a';
  exception when insufficient_privilege then
    v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'customer cannot insert an order directly');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    update public.orders set total = 0.01 where id = (select id from t_ids where key = 'order');
  exception when insufficient_privilege then
    v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'customer cannot update an order total');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    update public.profiles set role = 'admin' where id = (select id from t_ids where key = 'customer_a');
  exception when insufficient_privilege then
    v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'customer cannot escalate their own role');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    perform public.transition_order_status(
      (select id from t_ids where key = 'order'), 'delivered'::public.order_status);
  exception when insufficient_privilege then
    v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'customer cannot mark their own order delivered');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    perform public.create_order(
      (select id from t_ids where key = 'restaurant'),
      jsonb_build_array(jsonb_build_object('dish_id', (select id from t_ids where key = 'dish'),
                                           'quantity', 1000, 'addon_ids', '[]'::jsonb)),
      'pickup', null, null, 0, 'cash', false, false, gen_random_uuid());
  exception when others then
    v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'quantity above the configured maximum is rejected');
end;
$$;

reset role;

do $$
declare v_c uuid;
begin
  select id into v_c from t_ids where key = 'customer_c';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c, 'role', 'authenticated', 'is_anonymous', false)::text, true);
end;
$$;
set local role authenticated;

do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.orders where id = (select id from t_ids where key = 'order')) = 0,
    'another customer cannot read the order');
  perform pg_temp.assert(
    (select count(*) from public.order_items
      where order_id = (select id from t_ids where key = 'order')) = 0,
    'another customer cannot read the order items');
  perform pg_temp.assert(
    (select count(*) from public.order_status_history
      where order_id = (select id from t_ids where key = 'order')) = 0,
    'another customer cannot read the order history');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    perform public.transition_order_status(
      (select id from t_ids where key = 'order'), 'accepted'::public.order_status);
  exception when insufficient_privilege then
    v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'unrelated customer cannot transition the order');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    update public.dishes set price = 0.01 where id = (select id from t_ids where key = 'dish');
    if not found then v_failed := true; end if;
  exception when others then
    v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'non-member cannot change a restaurant dish price');
end;
$$;

reset role;

do $$
declare v_b uuid;
begin
  select id into v_b from t_ids where key = 'merchant_b';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated', 'is_anonymous', false)::text, true);
end;
$$;
set local role authenticated;

do $$
declare
  v_order public.orders;
  v_failed boolean := false;
begin
  perform pg_temp.assert(
    (select count(*) from public.orders where id = (select id from t_ids where key = 'order')) = 1,
    'restaurant member can read an order for their restaurant');

  begin
    perform public.transition_order_status(
      (select id from t_ids where key = 'order'), 'delivered'::public.order_status);
  exception when insufficient_privilege then
    v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'restaurant cannot skip straight to delivered');

  v_order := public.transition_order_status(
    (select id from t_ids where key = 'order'), 'accepted'::public.order_status);
  perform pg_temp.assert(v_order.status = 'accepted', 'restaurant can accept a placed order');

  v_order := public.transition_order_status(
    (select id from t_ids where key = 'order'), 'preparing'::public.order_status);
  v_order := public.transition_order_status(
    (select id from t_ids where key = 'order'), 'ready_for_pickup'::public.order_status);
  perform pg_temp.assert(v_order.status = 'ready_for_pickup', 'restaurant can progress to ready');

  perform pg_temp.assert(
    (select count(*) from public.order_status_history
      where order_id = (select id from t_ids where key = 'order')) = 4,
    'every transition is recorded in the history');

  update public.dishes set price = 12.50 where id = (select id from t_ids where key = 'dish');
  perform pg_temp.assert(
    (select price from public.dishes where id = (select id from t_ids where key = 'dish')) = 12.50,
    'restaurant member can edit their own menu');
end;
$$;

reset role;

rollback;
