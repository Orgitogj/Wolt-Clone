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
grant all on t_ids to authenticated;

insert into auth.users (id, email) values
  (gen_random_uuid(), 'cx@courier.test'),
  (gen_random_uuid(), 'mb@courier.test'),
  (gen_random_uuid(), 'c1@courier.test'),
  (gen_random_uuid(), 'c2@courier.test');

insert into t_ids (key, id)
select 'customer', id from auth.users where email = 'cx@courier.test'
union all select 'merchant', id from auth.users where email = 'mb@courier.test'
union all select 'courier1', id from auth.users where email = 'c1@courier.test'
union all select 'courier2', id from auth.users where email = 'c2@courier.test';

insert into public.restaurants (name, min_order, is_open, latitude, longitude)
values ('Dispatch Test Kitchen', 0, true, 51.9625, 7.6257);
insert into t_ids (key, id)
select 'restaurant', id from public.restaurants where name = 'Dispatch Test Kitchen';

insert into public.menu_categories (restaurant_id, name)
select id, 'Mains' from t_ids where key = 'restaurant';

insert into public.dishes (restaurant_id, menu_category_id, name, price, is_available)
select r.id, m.id, 'Dispatch Dish', 10.00, true
  from t_ids r join public.menu_categories m on m.restaurant_id = r.id
 where r.key = 'restaurant';
insert into t_ids (key, id) select 'dish', id from public.dishes where name = 'Dispatch Dish';

insert into public.addresses (user_id, label, address_line, latitude, longitude)
select id, 'Home', 'Dispatchweg 9', 51.9700, 7.6350 from t_ids where key = 'customer';
insert into t_ids (key, id) select 'address', id from public.addresses where address_line = 'Dispatchweg 9';

insert into public.restaurant_members (restaurant_id, user_id, role)
select r.id, u.id, 'owner' from t_ids r, t_ids u where r.key = 'restaurant' and u.key = 'merchant';

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'courier1')); end $$;
set local role authenticated;
do $$
begin
  perform public.register_courier('Courier One', '+49 100', 'scooter', 'MS-C1');
  perform pg_temp.assert(
    (select verification_status from public.couriers where id = auth.uid()) = 'pending',
    'a new courier starts unverified');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    perform public.set_courier_availability('online');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'an unapproved courier cannot go online');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'courier2')); end $$;
set local role authenticated;
do $$ begin perform public.register_courier('Courier Two', '+49 200', 'bicycle', null); end $$;
reset role;

update public.couriers set verification_status = 'approved';

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'courier1')); end $$;
set local role authenticated;
do $$
begin
  perform public.update_courier_location(51.9630, 7.6260);
  perform public.set_courier_availability('online');
  perform pg_temp.assert(
    (select availability from public.couriers where id = auth.uid()) = 'online',
    'an approved courier can go online');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'courier2')); end $$;
set local role authenticated;
do $$
begin
  perform public.update_courier_location(51.9900, 7.7000);
  perform public.set_courier_availability('online');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'customer')); end $$;
set local role authenticated;
do $$
declare v_order public.orders;
begin
  v_order := public.create_order(
    (select id from t_ids where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object('dish_id', (select id from t_ids where key = 'dish'),
                                         'quantity', 1, 'addon_ids', '[]'::jsonb)),
    'delivery', (select id from t_ids where key = 'address'), null, 2.00, 'cash', false, false,
    gen_random_uuid());
  insert into t_ids (key, id) values ('order', v_order.id);
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'merchant')); end $$;
set local role authenticated;
do $$
declare v_order_id uuid := (select id from t_ids where key = 'order');
begin
  perform public.transition_order_status(v_order_id, 'accepted');
  perform public.transition_order_status(v_order_id, 'preparing');
  perform pg_temp.assert(
    (select count(*) from public.deliveries where order_id = v_order_id) = 0,
    'no delivery exists before the order is ready');
  perform public.transition_order_status(v_order_id, 'ready_for_pickup');
end;
$$;
reset role;

do $$
declare v_delivery public.deliveries;
begin
  select * into v_delivery from public.deliveries
   where order_id = (select id from t_ids where key = 'order');
  perform pg_temp.assert(v_delivery.id is not null, 'marking ready creates a delivery');
  perform pg_temp.assert(v_delivery.status = 'pending', 'the new delivery starts pending');
  perform pg_temp.assert(v_delivery.distance_km > 0, 'the delivery distance is computed');
  insert into t_ids (key, id) values ('delivery', v_delivery.id);

  perform pg_temp.assert(
    (select count(*) from public.delivery_offers where delivery_id = v_delivery.id) = 1,
    'exactly one courier is offered the delivery first');
  perform pg_temp.assert(
    (select courier_id from public.delivery_offers where delivery_id = v_delivery.id)
      = (select id from t_ids where key = 'courier1'),
    'the nearest courier is offered the delivery');
end;
$$;

insert into public.delivery_offers (delivery_id, courier_id, rank, expires_at)
select d.id, c.id, 2, now() + interval '45 seconds'
  from t_ids d, t_ids c
 where d.key = 'delivery' and c.key = 'courier2';

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'courier2')); end $$;
set local role authenticated;
do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.delivery_offers where courier_id = auth.uid()) = 1,
    'a courier sees only their own offers');
  perform pg_temp.assert(
    (select count(*) from public.deliveries where id = (select id from t_ids where key = 'delivery')) = 1,
    'an offered courier can read the delivery');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'courier1')); end $$;
set local role authenticated;
do $$
declare v_delivery public.deliveries;
begin
  v_delivery := public.respond_to_delivery_offer(
    (select id from public.delivery_offers
      where delivery_id = (select id from t_ids where key = 'delivery')
        and courier_id = auth.uid()),
    true);
  perform pg_temp.assert(v_delivery.status = 'assigned', 'the first courier wins the delivery');
  perform pg_temp.assert(v_delivery.courier_id = auth.uid(), 'the winner is recorded on the delivery');
  perform pg_temp.assert(
    (select status from public.orders where id = (select id from t_ids where key = 'order'))
      = 'courier_assigned',
    'accepting moves the order to courier_assigned');
  perform pg_temp.assert(
    (select availability from public.couriers where id = auth.uid()) = 'busy',
    'the assigned courier becomes busy');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'courier2')); end $$;
set local role authenticated;
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.respond_to_delivery_offer(
      (select id from public.delivery_offers
        where delivery_id = (select id from t_ids where key = 'delivery')
          and courier_id = auth.uid()),
      true);
  exception when insufficient_privilege then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a second courier cannot accept the same delivery');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    perform public.courier_advance_delivery(
      (select id from t_ids where key = 'delivery'), 'picked_up');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a courier cannot advance a delivery assigned to someone else');
end;
$$;

do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.courier_earnings) = 0,
    'no earnings exist before delivery completes');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'courier1')); end $$;
set local role authenticated;
do $$
declare
  v_delivery_id uuid := (select id from t_ids where key = 'delivery');
  v_failed boolean := false;
  v_delivery public.deliveries;
begin
  begin
    perform public.courier_advance_delivery(v_delivery_id, 'delivered');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a courier cannot skip straight to delivered');

  perform public.courier_advance_delivery(v_delivery_id, 'picked_up');
  perform pg_temp.assert(
    (select status from public.orders where id = (select id from t_ids where key = 'order')) = 'picked_up',
    'pickup is mirrored onto the order');

  perform public.courier_advance_delivery(v_delivery_id, 'delivering');
  v_delivery := public.courier_advance_delivery(v_delivery_id, 'delivered');

  perform pg_temp.assert(v_delivery.status = 'delivered', 'the courier can complete the delivery');
  perform pg_temp.assert(
    (select status from public.orders where id = (select id from t_ids where key = 'order')) = 'delivered',
    'completing the delivery delivers the order');
  perform pg_temp.assert(
    (select availability from public.couriers where id = auth.uid()) = 'online',
    'the courier returns to online after delivering');
  perform pg_temp.assert(
    (select total from public.courier_earnings where delivery_id = v_delivery_id) > 0,
    'earnings are written when the delivery completes');
  perform pg_temp.assert(
    (select tip from public.courier_earnings where delivery_id = v_delivery_id) = 2.00,
    'the customer tip goes to the courier');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'courier2')); end $$;
set local role authenticated;
do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.courier_earnings) = 0,
    'a courier cannot read another courier earnings');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'customer')); end $$;
set local role authenticated;
do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.courier_earnings) = 0,
    'a customer cannot read courier earnings');
  perform pg_temp.assert(
    (select count(*) from public.couriers) = 0,
    'a customer cannot read the couriers table directly');
  perform pg_temp.assert(
    (select count(*) from public.delivery_couriers
      where order_id = (select id from t_ids where key = 'order')) = 0,
    'the tracking view drops the courier once the delivery is complete');
end;
$$;
reset role;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'courier1')); end $$;
set local role authenticated;

do $$
declare
  v_document public.courier_documents;
  v_courier_id uuid := (select id from t_ids where key = 'courier1');
begin
  v_document := public.submit_courier_document(
    'id_card'::public.courier_document_kind, v_courier_id::text || '/id_card.jpg');
  perform pg_temp.assert(v_document.status = 'pending',
    'a submitted document starts unreviewed');
  perform pg_temp.assert(v_document.courier_id = v_courier_id,
    'a document is filed against the courier who submitted it');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    perform public.submit_courier_document(
      'id_card'::public.courier_document_kind,
      (select id from t_ids where key = 'courier2')::text || '/id_card.jpg');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a courier cannot file a document into another folder');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.courier_documents (courier_id, kind, storage_path, status)
    values (auth.uid(), 'insurance', auth.uid()::text || '/insurance.jpg', 'approved');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a courier cannot insert an already approved document');
end;
$$;
reset role;

do $$
declare v_courier_id uuid := (select id from t_ids where key = 'courier1');
begin
  update public.courier_documents
     set status = 'rejected', notes = 'Blurred photo', reviewed_at = now()
   where courier_id = v_courier_id and kind = 'id_card';
  update public.couriers set verification_status = 'rejected' where id = v_courier_id;
end;
$$;

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'courier1')); end $$;
set local role authenticated;

do $$
declare
  v_document public.courier_documents;
  v_courier_id uuid := (select id from t_ids where key = 'courier1');
begin
  v_document := public.submit_courier_document(
    'id_card'::public.courier_document_kind, v_courier_id::text || '/id_card.png');

  perform pg_temp.assert(v_document.status = 'pending',
    'replacing a rejected document clears the rejection');
  perform pg_temp.assert(v_document.notes is null,
    'replacing a document clears the reviewer note');
  perform pg_temp.assert(v_document.storage_path = v_courier_id::text || '/id_card.png',
    'replacing a document keeps one row per kind');
  perform pg_temp.assert(
    (select count(*) from public.courier_documents
      where courier_id = v_courier_id and kind = 'id_card') = 1,
    'a replaced document does not duplicate the row');
  perform pg_temp.assert(
    (select verification_status from public.couriers where id = v_courier_id) = 'pending',
    'a rejected courier returns to review when they resubmit');
end;
$$;
reset role;

rollback;
