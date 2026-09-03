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

create temporary table t_ids (key text primary key, id uuid not null) on commit drop;
grant all on t_ids to authenticated;

insert into auth.users (id, email) values
  (gen_random_uuid(), 'admin@admin.test'),
  (gen_random_uuid(), 'admin2@admin.test'),
  (gen_random_uuid(), 'cx@admin.test'),
  (gen_random_uuid(), 'staff@admin.test'),
  (gen_random_uuid(), 'rider@admin.test');

insert into t_ids (key, id)
select 'admin', id from auth.users where email = 'admin@admin.test'
union all select 'admin2', id from auth.users where email = 'admin2@admin.test'
union all select 'customer', id from auth.users where email = 'cx@admin.test'
union all select 'staff', id from auth.users where email = 'staff@admin.test'
union all select 'courier', id from auth.users where email = 'rider@admin.test';

update public.profiles set role = 'admin' where id = (select id from t_ids where key = 'admin');

insert into public.restaurants (name, min_order, is_open, latitude, longitude)
values ('Admin Test Kitchen', 0, true, 51.9625, 7.6257);
insert into t_ids (key, id) select 'restaurant', id from public.restaurants where name = 'Admin Test Kitchen';

insert into public.menu_categories (restaurant_id, name)
select id, 'Mains' from t_ids where key = 'restaurant';

insert into public.dishes (restaurant_id, menu_category_id, name, price, is_available)
select r.id, m.id, 'Admin Dish', 12.00, true
  from t_ids r join public.menu_categories m on m.restaurant_id = r.id
 where r.key = 'restaurant';
insert into t_ids (key, id) select 'dish', id from public.dishes where name = 'Admin Dish';

insert into public.addresses (user_id, label, address_line, latitude, longitude)
select id, 'Home', 'Adminweg 4', 51.9700, 7.6350 from t_ids where key = 'customer';
insert into t_ids (key, id) select 'address', id from public.addresses where address_line = 'Adminweg 4';

insert into public.couriers (id, full_name, vehicle_type, current_latitude, current_longitude,
                             location_updated_at)
select id, 'Admin Rider', 'scooter', 51.9630, 7.6260, now() from t_ids where key = 'courier';

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'customer')); end $$;
set local role authenticated;

do $$
declare v_failed boolean := false;
begin
  begin
    perform public.require_admin();
  exception when insufficient_privilege then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a customer fails the administrator guard');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    perform public.admin_set_user_role(
      (select id from t_ids where key = 'staff'), 'admin'::public.user_role);
  exception when insufficient_privilege then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a customer cannot grant themselves help by promoting anyone');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    perform public.admin_review_courier(
      (select id from t_ids where key = 'courier'), 'approved'::public.verification_status, null);
  exception when insufficient_privilege then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a customer cannot approve a courier');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    perform public.admin_set_restaurant_member(
      (select id from t_ids where key = 'restaurant'),
      (select id from t_ids where key = 'customer'), 'owner');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a customer cannot make themselves a restaurant member');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    perform public.admin_update_platform_settings('{"commission_rate": 0}'::jsonb);
  exception when insufficient_privilege then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a customer cannot rewrite the platform settings');
end;
$$;

do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.admin_overview) = 0,
    'a customer sees no platform overview');
  perform pg_temp.assert(
    (select count(*) from public.admin_users) = 0,
    'a customer cannot list the platform users');
  perform pg_temp.assert(
    (select count(*) from public.admin_orders) = 0,
    'a customer cannot list every order');
  perform pg_temp.assert(
    (select count(*) from public.admin_couriers) = 0,
    'a customer cannot list the courier fleet');
  perform pg_temp.assert(
    (select count(*) from public.admin_actions) = 0,
    'a customer cannot read the admin audit log');
end;
$$;

do $$
declare v_order public.orders;
begin
  v_order := public.create_order(
    (select id from t_ids where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object('dish_id', (select id from t_ids where key = 'dish'),
                                         'quantity', 2, 'addon_ids', '[]'::jsonb)),
    'delivery', (select id from t_ids where key = 'address'), null, 1.00, 'cash', false, false,
    gen_random_uuid());
  insert into t_ids (key, id) values ('order', v_order.id);
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'admin')); end $$;
set local role authenticated;

do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.admin_overview) = 1,
    'an admin reads the platform overview');
  perform pg_temp.assert(
    (select active_orders from public.admin_overview) >= 1,
    'the overview counts the live order');
  perform pg_temp.assert(
    (select count(*) from public.admin_orders
      where order_id = (select id from t_ids where key = 'order')) = 1,
    'an admin reads an order they did not place');
  perform pg_temp.assert(
    (select customer_email from public.admin_orders
      where order_id = (select id from t_ids where key = 'order')) = 'cx@admin.test',
    'the admin order view resolves the customer');
  perform pg_temp.assert(
    (select count(*) from public.admin_users) = 5,
    'an admin lists every account');
end;
$$;

do $$
declare v_profile public.profiles;
begin
  v_profile := public.admin_set_user_role(
    (select id from t_ids where key = 'staff'), 'courier'::public.user_role);
  perform pg_temp.assert(v_profile.role = 'courier', 'an admin changes a platform role');
  perform pg_temp.assert(
    (select count(*) from public.admin_actions
      where action = 'set_user_role'
        and subject_id = (select id from t_ids where key = 'staff')::text) = 1,
    'the role change is written to the audit log');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    perform public.admin_set_user_role(
      (select id from t_ids where key = 'admin'), 'customer'::public.user_role);
  exception when insufficient_privilege then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'an admin cannot change their own role');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  perform public.admin_set_user_role(
    (select id from t_ids where key = 'admin2'), 'admin'::public.user_role);
  perform public.admin_set_user_role(
    (select id from t_ids where key = 'admin2'), 'customer'::public.user_role);
  perform pg_temp.assert(
    (select role from public.profiles where id = (select id from t_ids where key = 'admin2'))
      = 'customer',
    'a second admin can be demoted while another remains');
end;
$$;

do $$
declare
  v_member public.restaurant_members;
  v_failed boolean := false;
begin
  v_member := public.admin_set_restaurant_member(
    (select id from t_ids where key = 'restaurant'),
    (select id from t_ids where key = 'staff'), 'manager');
  perform pg_temp.assert(v_member.role = 'manager', 'an admin grants restaurant access');

  begin
    perform public.admin_set_restaurant_member(
      (select id from t_ids where key = 'restaurant'),
      (select id from t_ids where key = 'staff'), 'chef');
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'an unknown restaurant role is rejected');
end;
$$;

do $$
declare v_courier public.couriers;
begin
  v_courier := public.admin_review_courier(
    (select id from t_ids where key = 'courier'), 'approved'::public.verification_status,
    'Documents look good');
  perform pg_temp.assert(v_courier.verification_status = 'approved',
    'an admin approves a courier application');
  perform pg_temp.assert(v_courier.verification_notes = 'Documents look good',
    'the review note is stored on the courier');
end;
$$;

do $$
declare
  v_settings public.platform_settings;
  v_failed boolean := false;
begin
  v_settings := public.admin_update_platform_settings(
    '{"commission_rate": 0.2000, "card_payments_enabled": true}'::jsonb);
  perform pg_temp.assert(v_settings.commission_rate = 0.2000,
    'an admin updates the commission rate');
  perform pg_temp.assert(v_settings.card_payments_enabled,
    'an admin switches card payments on');
  perform pg_temp.assert(v_settings.service_fee = 0.83,
    'an unlisted setting keeps its value');

  begin
    perform public.admin_update_platform_settings('{"id": false}'::jsonb);
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a setting outside the allow list is rejected');

  v_failed := false;
  begin
    perform public.admin_update_platform_settings('{"currency": "euro"}'::jsonb);
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a malformed currency is rejected');

  v_failed := false;
  begin
    perform public.admin_update_platform_settings('{"commission_rate": 2}'::jsonb);
  exception when others then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a commission rate above one is rejected');
end;
$$;

do $$
declare v_order_id uuid := (select id from t_ids where key = 'order');
begin
  perform public.transition_order_status(v_order_id, 'accepted');
  perform public.transition_order_status(v_order_id, 'preparing');
  perform public.transition_order_status(v_order_id, 'ready_for_pickup');
  perform pg_temp.assert(
    (select count(*) from public.order_status_history
      where order_id = v_order_id and to_status = 'accepted' and actor_role = 'admin') = 1,
    'an admin transition is attributed to the admin');
end;
$$;
reset role;

insert into t_ids (key, id)
select 'delivery', id from public.deliveries where order_id = (select id from t_ids where key = 'order');

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'admin')); end $$;
set local role authenticated;

do $$
declare
  v_delivery public.deliveries;
  v_failed boolean := false;
begin
  begin
    perform public.admin_assign_delivery(
      (select id from t_ids where key = 'delivery'),
      (select id from t_ids where key = 'staff'));
  exception when insufficient_privilege then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'an unapproved courier cannot be assigned a delivery');

  v_delivery := public.admin_assign_delivery(
    (select id from t_ids where key = 'delivery'),
    (select id from t_ids where key = 'courier'));

  perform pg_temp.assert(v_delivery.status = 'assigned', 'an admin assigns a stuck delivery');
  perform pg_temp.assert(
    v_delivery.courier_id = (select id from t_ids where key = 'courier'),
    'the delivery records the chosen courier');
  perform pg_temp.assert(
    (select status from public.orders where id = (select id from t_ids where key = 'order'))
      = 'courier_assigned',
    'assigning a courier moves the order forward');
  perform pg_temp.assert(
    (select availability from public.couriers where id = (select id from t_ids where key = 'courier'))
      = 'busy',
    'the assigned courier becomes busy');
  perform pg_temp.assert(
    (select count(*) from public.delivery_offers
      where delivery_id = v_delivery.id and status = 'pending') = 0,
    'no offer stays open once an admin assigns the delivery');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    perform public.admin_review_courier(
      (select id from t_ids where key = 'courier'), 'suspended'::public.verification_status, null);
  exception when insufficient_privilege then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a courier cannot be withdrawn mid delivery');
end;
$$;

do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.admin_actions) >= 6,
    'every admin action is recorded');
  perform pg_temp.assert(
    (select count(*) from public.admin_actions where admin_id is null) = 0,
    'every audit row names the admin who acted');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'staff')); end $$;
set local role authenticated;

do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.orders
      where id = (select id from t_ids where key = 'order')) = 1,
    'the promoted member now reads the restaurant orders');
  perform pg_temp.assert(
    (select count(*) from public.admin_actions) = 0,
    'a restaurant member still cannot read the audit log');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'admin')); end $$;
set local role authenticated;
do $$
begin
  perform public.admin_remove_restaurant_member(
    (select id from t_ids where key = 'restaurant'),
    (select id from t_ids where key = 'staff'));
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'staff')); end $$;
set local role authenticated;
do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.orders
      where id = (select id from t_ids where key = 'order')) = 0,
    'removing the membership revokes the restaurant orders again');
end;
$$;
reset role;

rollback;
