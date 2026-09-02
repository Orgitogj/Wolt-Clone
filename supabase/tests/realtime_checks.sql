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
  (gen_random_uuid(), 'cx@rt.test'),
  (gen_random_uuid(), 'other@rt.test'),
  (gen_random_uuid(), 'mb@rt.test'),
  (gen_random_uuid(), 'c1@rt.test');

insert into t_ids (key, id)
select 'customer', id from auth.users where email = 'cx@rt.test'
union all select 'other', id from auth.users where email = 'other@rt.test'
union all select 'merchant', id from auth.users where email = 'mb@rt.test'
union all select 'courier', id from auth.users where email = 'c1@rt.test';

insert into public.restaurants (name, min_order, is_open, latitude, longitude)
values ('Realtime Test Kitchen', 0, true, 51.9625, 7.6257);
insert into t_ids (key, id) select 'restaurant', id from public.restaurants where name = 'Realtime Test Kitchen';

insert into public.menu_categories (restaurant_id, name)
select id, 'Mains' from t_ids where key = 'restaurant';

insert into public.dishes (restaurant_id, menu_category_id, name, price, is_available)
select r.id, m.id, 'Realtime Dish', 12.00, true
  from t_ids r join public.menu_categories m on m.restaurant_id = r.id
 where r.key = 'restaurant';
insert into t_ids (key, id) select 'dish', id from public.dishes where name = 'Realtime Dish';

insert into public.addresses (user_id, label, address_line, latitude, longitude)
select id, 'Home', 'Realtimeweg 3', 51.9700, 7.6350 from t_ids where key = 'customer';
insert into t_ids (key, id) select 'address', id from public.addresses where address_line = 'Realtimeweg 3';

insert into public.restaurant_members (restaurant_id, user_id, role)
select r.id, u.id, 'owner' from t_ids r, t_ids u where r.key = 'restaurant' and u.key = 'merchant';

insert into public.couriers (id, full_name, vehicle_type, verification_status, availability,
                             current_latitude, current_longitude, location_updated_at)
select id, 'Realtime Courier', 'scooter', 'approved', 'online', 51.9630, 7.6260, now()
  from t_ids where key = 'courier';

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'customer')); end $$;
set local role authenticated;
do $$
declare v_order public.orders;
begin
  v_order := public.create_order(
    (select id from t_ids where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object('dish_id', (select id from t_ids where key = 'dish'),
                                         'quantity', 1, 'addon_ids', '[]'::jsonb)),
    'delivery', (select id from t_ids where key = 'address'), null, 1.50, 'cash', false, false,
    gen_random_uuid());
  insert into t_ids (key, id) values ('order', v_order.id);

  perform pg_temp.assert(
    (select count(*) from public.notifications
      where order_id = v_order.id and audience = 'customer' and kind = 'placed') = 1,
    'placing an order notifies the customer');
end;
$$;
reset role;

do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.notifications n
      join t_ids u on u.id = n.user_id
     where u.key = 'merchant' and n.kind = 'placed') = 1,
    'placing an order notifies the restaurant');
  perform pg_temp.assert(
    (select body from public.notifications n
      join t_ids u on u.id = n.user_id
     where u.key = 'customer' and n.kind = 'placed') like '%Realtime Test Kitchen%',
    'the customer notification names the restaurant');
end;
$$;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'other')); end $$;
set local role authenticated;
do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.notifications) = 0,
    'a user cannot read another user notifications');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'merchant')); end $$;
set local role authenticated;
do $$
declare v_order_id uuid := (select id from t_ids where key = 'order');
begin
  perform public.transition_order_status(v_order_id, 'accepted');
  perform pg_temp.assert(
    (select count(*) from public.notifications
      where order_id = v_order_id and kind = 'accepted' and audience = 'customer') = 1,
    'accepting an order notifies the customer');

  perform public.transition_order_status(v_order_id, 'preparing');
  perform public.transition_order_status(v_order_id, 'ready_for_pickup');
end;
$$;
reset role;

insert into t_ids (key, id)
select 'delivery', id from public.deliveries where order_id = (select id from t_ids where key = 'order');

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'courier')); end $$;
set local role authenticated;
do $$
declare v_delivery_id uuid;
begin
  perform public.respond_to_delivery_offer(
    (select id from public.delivery_offers
      where delivery_id = (select id from t_ids where key = 'delivery')
        and courier_id = auth.uid()),
    true);

  v_delivery_id := public.record_courier_location(51.9640, 7.6280, 8.0, 90.0, 4.2);
  perform pg_temp.assert(v_delivery_id = (select id from t_ids where key = 'delivery'),
    'location is attached to the active delivery');
  perform pg_temp.assert(
    (select count(*) from public.courier_locations
      where delivery_id = (select id from t_ids where key = 'delivery')) = 1,
    'an active courier writes location history');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'customer')); end $$;
set local role authenticated;
do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.courier_locations
      where delivery_id = (select id from t_ids where key = 'delivery')) = 1,
    'the customer can follow their own courier');
  perform pg_temp.assert(
    (select count(*) from public.delivery_couriers
      where order_id = (select id from t_ids where key = 'order')) = 1,
    'the tracking view exposes the assigned courier');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'other')); end $$;
set local role authenticated;
do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.courier_locations) = 0,
    'an unrelated user cannot follow a courier');
  perform pg_temp.assert(
    (select count(*) from public.delivery_couriers) = 0,
    'an unrelated user sees nothing in the tracking view');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'courier')); end $$;
set local role authenticated;
do $$
declare v_delivery_id uuid := (select id from t_ids where key = 'delivery');
begin
  perform public.courier_advance_delivery(v_delivery_id, 'picked_up');
  perform public.courier_advance_delivery(v_delivery_id, 'delivering');
  perform public.courier_advance_delivery(v_delivery_id, 'delivered');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'customer')); end $$;
set local role authenticated;
do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.courier_locations
      where delivery_id = (select id from t_ids where key = 'delivery')) = 0,
    'location history stops being readable once the delivery is done');
  perform pg_temp.assert(
    (select count(*) from public.notifications
      where order_id = (select id from t_ids where key = 'order')
        and kind = 'delivered' and audience = 'customer') = 1,
    'delivery completion notifies the customer');
end;
$$;

do $$
declare v_marked int;
begin
  perform public.register_push_token('ExponentPushToken[customer-token]', 'android');
  perform pg_temp.assert(
    (select count(*) from public.push_tokens where user_id = auth.uid()) = 1,
    'a user can register a push token');

  v_marked := public.mark_notifications_read(null);
  perform pg_temp.assert(v_marked > 0, 'the customer can mark their notifications read');
  perform pg_temp.assert(
    (select count(*) from public.notifications where user_id = auth.uid() and read_at is null) = 0,
    'no unread notifications remain for the customer');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'merchant')); end $$;
set local role authenticated;
do $$
declare v_marked int;
begin
  perform pg_temp.assert(
    (select count(*) from public.push_tokens) = 0,
    'a user cannot read another user push tokens');
  perform pg_temp.assert(
    (select count(*) from public.notifications where read_at is null) > 0,
    'marking read did not touch the restaurant notifications');
  v_marked := public.mark_notifications_read(null);
  perform pg_temp.assert(v_marked > 0, 'the restaurant marks only its own notifications read');
end;
$$;
reset role;

do $$
begin
  perform pg_temp.assert(
    (select count(*) from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename in ('orders','deliveries','delivery_offers','courier_locations','notifications')) = 5,
    'every live table is published for realtime');
end;
$$;

rollback;
