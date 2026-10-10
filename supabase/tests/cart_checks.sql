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

create temporary table t_cart (key text primary key, id uuid not null) on commit drop;
grant all on t_cart to anon, authenticated;

insert into auth.users (id, email) values
  (gen_random_uuid(), 'cart-customer@test.local'),
  (gen_random_uuid(), 'cart-admin@test.local');

insert into t_cart (key, id)
select 'customer', id from auth.users where email = 'cart-customer@test.local'
union all select 'admin', id from auth.users where email = 'cart-admin@test.local';

update public.profiles set role = 'admin' where id = (select id from t_cart where key = 'admin');

insert into public.restaurants (name, min_order, is_open, latitude, longitude)
values ('Cart Kitchen', 10, true, 51.9625, 7.6257);
insert into t_cart (key, id) select 'restaurant', id from public.restaurants where name = 'Cart Kitchen';

insert into public.restaurants (name, min_order, is_open, latitude, longitude)
values ('Other Kitchen', 0, true, 51.9625, 7.6257);
insert into t_cart (key, id) select 'other_restaurant', id from public.restaurants where name = 'Other Kitchen';

insert into public.menu_categories (restaurant_id, name)
select id, 'Mains' from t_cart where key = 'restaurant';
insert into public.menu_categories (restaurant_id, name)
select id, 'Mains' from t_cart where key = 'other_restaurant';

insert into public.dishes (restaurant_id, menu_category_id, name, price, is_available)
select r.id, m.id, 'Cart Dish', 12.00, true
  from t_cart r join public.menu_categories m on m.restaurant_id = r.id
 where r.key = 'restaurant';
insert into t_cart (key, id) select 'dish', id from public.dishes where name = 'Cart Dish';

insert into public.dishes (restaurant_id, menu_category_id, name, price, is_available)
select r.id, m.id, 'Other Dish', 8.00, true
  from t_cart r join public.menu_categories m on m.restaurant_id = r.id
 where r.key = 'other_restaurant';
insert into t_cart (key, id) select 'other_dish', id from public.dishes where name = 'Other Dish';

insert into public.dish_addons (dish_id, name, price_delta, sort_order)
select id, 'Extra cheese', 1.50, 1 from t_cart where key = 'dish';
insert into t_cart (key, id) select 'addon', id from public.dish_addons where name = 'Extra cheese';

create or replace function pg_temp.cart(p_items jsonb)
returns record language plpgsql as $$
declare v_row record;
begin
  select * into v_row
    from public.validate_cart((select id from t_cart where key = 'restaurant'), p_items);
  return v_row;
end;
$$;

create or replace function pg_temp.line(p_items jsonb, p_index int default 0)
returns jsonb language plpgsql as $$
declare v_lines jsonb;
begin
  select lines into v_lines
    from public.validate_cart((select id from t_cart where key = 'restaurant'), p_items);
  return v_lines -> p_index;
end;
$$;

create or replace function pg_temp.items(p_unit_price numeric default null, p_quantity int default 1)
returns jsonb language plpgsql as $$
begin
  return jsonb_build_array(
    jsonb_build_object(
      'dish_id', (select id from t_cart where key = 'dish'),
      'quantity', p_quantity,
      'addon_ids', '[]'::jsonb
    ) || case when p_unit_price is null then '{}'::jsonb
              else jsonb_build_object('unit_price', p_unit_price) end
  );
end;
$$;

do $$
declare v_line jsonb; v_row record;
begin
  perform pg_temp.act_as((select id from t_cart where key = 'customer'));

  v_line := pg_temp.line(pg_temp.items(12.00));
  perform pg_temp.assert((v_line ->> 'unit_price')::numeric = 12.00,
    'the current price is returned for an unchanged line');
  perform pg_temp.assert((v_line ->> 'price_changed')::boolean = false,
    'a matching price is not reported as changed');
  perform pg_temp.assert((v_line ->> 'is_available')::boolean,
    'an available dish is reported available');
  perform pg_temp.assert((v_line ->> 'dish_found')::boolean, 'the dish is found');
  perform pg_temp.assert(v_line ->> 'dish_name' = 'Cart Dish', 'the dish name is returned');

  v_row := pg_temp.cart(pg_temp.items(12.00));
  perform pg_temp.assert(not (v_row.has_changes), 'an unchanged cart reports no changes');
end;
$$;

do $$
declare v_line jsonb; v_row record;
begin
  perform pg_temp.act_as((select id from t_cart where key = 'customer'));
  update public.dishes set price = 14.50 where id = (select id from t_cart where key = 'dish');

  v_line := pg_temp.line(pg_temp.items(12.00));
  perform pg_temp.assert((v_line ->> 'price_changed')::boolean,
    'a price that moved is reported as changed');
  perform pg_temp.assert((v_line ->> 'unit_price')::numeric = 14.50,
    'the new price is returned');
  perform pg_temp.assert((v_line ->> 'requested_unit_price')::numeric = 12.00,
    'the price the cart was holding is echoed back');

  v_row := pg_temp.cart(pg_temp.items(12.00));
  perform pg_temp.assert(v_row.has_changes, 'a price change makes the cart need attention');
  perform pg_temp.assert(v_row.subtotal = 14.50, 'the subtotal uses the current price');

  update public.dishes set price = 12.00 where id = (select id from t_cart where key = 'dish');
end;
$$;

do $$
declare v_line jsonb; v_row record;
begin
  perform pg_temp.act_as((select id from t_cart where key = 'customer'));

  v_line := pg_temp.line(pg_temp.items(12.00, 2));
  perform pg_temp.assert((v_line ->> 'line_total')::numeric = 24.00,
    'the line total multiplies by the quantity');

  v_row := pg_temp.cart(pg_temp.items(12.00, 2));
  perform pg_temp.assert(v_row.subtotal = 24.00, 'the subtotal adds the lines up');
  perform pg_temp.assert(v_row.meets_min_order, 'a basket above the minimum is accepted');
end;
$$;

do $$
declare v_line jsonb; v_row record;
begin
  perform pg_temp.act_as((select id from t_cart where key = 'customer'));
  update public.dishes set is_available = false where id = (select id from t_cart where key = 'dish');

  v_line := pg_temp.line(pg_temp.items(12.00));
  perform pg_temp.assert((v_line ->> 'dish_found')::boolean,
    'an unavailable dish is still found');
  perform pg_temp.assert((v_line ->> 'is_available')::boolean = false,
    'a dish taken off the menu is reported unavailable');
  perform pg_temp.assert((v_line ->> 'line_total')::numeric = 0,
    'an unavailable line contributes nothing to the total');

  v_row := pg_temp.cart(pg_temp.items(12.00));
  perform pg_temp.assert(v_row.has_changes, 'an unavailable dish makes the cart need attention');
  perform pg_temp.assert(v_row.subtotal = 0, 'the subtotal skips an unavailable line');
  perform pg_temp.assert(not v_row.meets_min_order,
    'a basket of only unavailable items misses the minimum');

  update public.dishes set is_available = true where id = (select id from t_cart where key = 'dish');
end;
$$;

do $$
declare v_line jsonb; v_items jsonb; v_addon_id uuid;
begin
  perform pg_temp.act_as((select id from t_cart where key = 'customer'));
  v_addon_id := (select id from t_cart where key = 'addon');

  v_items := jsonb_build_array(
    jsonb_build_object(
      'dish_id', (select id from t_cart where key = 'dish'),
      'quantity', 1,
      'addon_ids', jsonb_build_array(v_addon_id),
      'unit_price', 13.50
    )
  );

  v_line := pg_temp.line(v_items);
  perform pg_temp.assert((v_line ->> 'unit_price')::numeric = 13.50,
    'the add-on price is part of the unit price');
  perform pg_temp.assert((v_line ->> 'price_changed')::boolean = false,
    'a line with add-ons at the same price is unchanged');
  perform pg_temp.assert(jsonb_array_length(v_line -> 'addons') = 1,
    'the add-on is returned with the line');
  perform pg_temp.assert(jsonb_array_length(v_line -> 'missing_addon_ids') = 0,
    'nothing is missing while the add-on exists');

  delete from public.dish_addons where id = v_addon_id;

  v_line := pg_temp.line(v_items);
  perform pg_temp.assert(jsonb_array_length(v_line -> 'missing_addon_ids') = 1,
    'a deleted add-on is reported as missing');
  perform pg_temp.assert((v_line -> 'missing_addon_ids' ->> 0)::uuid = v_addon_id,
    'the missing add-on is named');
  perform pg_temp.assert((v_line ->> 'unit_price')::numeric = 12.00,
    'the unit price drops back to the dish price');
  perform pg_temp.assert((v_line ->> 'price_changed')::boolean,
    'losing an add-on is reported as a price change');

  insert into public.dish_addons (id, dish_id, name, price_delta, sort_order)
  values (v_addon_id, (select id from t_cart where key = 'dish'), 'Extra cheese', 1.50, 1);
end;
$$;

do $$
declare v_line jsonb; v_items jsonb;
begin
  perform pg_temp.act_as((select id from t_cart where key = 'customer'));

  v_items := jsonb_build_array(
    jsonb_build_object(
      'dish_id', (select id from t_cart where key = 'other_dish'),
      'quantity', 1,
      'addon_ids', '[]'::jsonb,
      'unit_price', 8.00
    )
  );

  v_line := pg_temp.line(v_items);
  perform pg_temp.assert((v_line ->> 'dish_found')::boolean = false,
    'a dish from another restaurant is refused');
  perform pg_temp.assert((v_line ->> 'is_available')::boolean = false,
    'a dish from another restaurant is never available');
  perform pg_temp.assert((v_line ->> 'line_total')::numeric = 0,
    'a foreign dish contributes nothing');
  perform pg_temp.assert(
    (select has_changes from public.validate_cart(
      (select id from t_cart where key = 'restaurant'), v_items)),
    'a foreign dish makes the cart need attention');
end;
$$;

do $$
declare v_line jsonb;
begin
  perform pg_temp.act_as((select id from t_cart where key = 'customer'));

  v_line := pg_temp.line(jsonb_build_array(
    jsonb_build_object('dish_id', gen_random_uuid(), 'quantity', 1, 'addon_ids', '[]'::jsonb)));
  perform pg_temp.assert((v_line ->> 'dish_found')::boolean = false,
    'an unknown dish id is refused');

  v_line := pg_temp.line(pg_temp.items(12.00, 0));
  perform pg_temp.assert((v_line ->> 'quantity_valid')::boolean = false,
    'a zero quantity is invalid');

  v_line := pg_temp.line(pg_temp.items(12.00, 9999));
  perform pg_temp.assert((v_line ->> 'quantity_valid')::boolean = false,
    'a quantity above the platform limit is invalid');

  perform pg_temp.assert(
    (select has_changes from public.validate_cart(
      (select id from t_cart where key = 'restaurant'), pg_temp.items(12.00, 0))),
    'an invalid quantity makes the cart need attention');
end;
$$;

do $$
declare v_row record;
begin
  perform pg_temp.act_as((select id from t_cart where key = 'customer'));

  v_row := pg_temp.cart(pg_temp.items(12.00));
  perform pg_temp.assert(v_row.is_open, 'an open restaurant is reported open');

  update public.restaurants set is_open = false
   where id = (select id from t_cart where key = 'restaurant');

  v_row := pg_temp.cart(pg_temp.items(12.00));
  perform pg_temp.assert(not v_row.is_open, 'a closed restaurant is reported closed');
  perform pg_temp.assert(v_row.has_changes, 'a closed restaurant makes the cart need attention');

  update public.restaurants set is_open = true
   where id = (select id from t_cart where key = 'restaurant');
end;
$$;

do $$
declare v_row record;
begin
  perform pg_temp.act_as((select id from t_cart where key = 'customer'));

  v_row := pg_temp.cart(pg_temp.items(12.00));
  perform pg_temp.assert(v_row.min_order = 10, 'the minimum order is returned');
  perform pg_temp.assert(v_row.meets_min_order, '12.00 clears a minimum of 10');

  update public.restaurants set min_order = 20
   where id = (select id from t_cart where key = 'restaurant');

  v_row := pg_temp.cart(pg_temp.items(12.00));
  perform pg_temp.assert(not v_row.meets_min_order, '12.00 misses a minimum of 20');
  perform pg_temp.assert(v_row.min_order = 20, 'the raised minimum is returned');

  update public.restaurants set min_order = 10
   where id = (select id from t_cart where key = 'restaurant');
end;
$$;

do $$
declare v_row record; v_count int;
begin
  perform pg_temp.act_as((select id from t_cart where key = 'customer'));

  select count(*) into v_count
    from public.validate_cart((select id from t_cart where key = 'restaurant'), '[]'::jsonb);
  perform pg_temp.assert(v_count = 1, 'an empty cart still reports the restaurant');

  v_row := pg_temp.cart('[]'::jsonb);
  perform pg_temp.assert(jsonb_array_length(v_row.lines) = 0, 'an empty cart has no lines');
  perform pg_temp.assert(v_row.subtotal = 0, 'an empty cart has no subtotal');
  perform pg_temp.assert(not v_row.has_changes, 'an empty cart needs no attention');

  select count(*) into v_count
    from public.validate_cart((select id from t_cart where key = 'restaurant'), null);
  perform pg_temp.assert(v_count = 1, 'a missing item list is treated as an empty cart');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  perform pg_temp.act_as((select id from t_cart where key = 'customer'));

  begin
    perform public.validate_cart(gen_random_uuid(), pg_temp.items(12.00));
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'an unknown restaurant is refused');

  v_failed := false;
  begin
    perform public.validate_cart(
      (select id from t_cart where key = 'restaurant'), '"not an array"'::jsonb);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a malformed item list is refused');
end;
$$;

do $$
declare v_price numeric; v_order public.orders;
begin
  perform pg_temp.act_as((select id from t_cart where key = 'customer'));

  insert into public.addresses (user_id, label, address_line, latitude, longitude)
  values ((select id from t_cart where key = 'customer'), 'Home', 'Cartweg 1', 51.9650, 7.6300);

  update public.dishes set price = 13.25 where id = (select id from t_cart where key = 'dish');

  v_order := public.create_order(
    (select id from t_cart where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object(
      'dish_id', (select id from t_cart where key = 'dish'),
      'quantity', 1,
      'addon_ids', jsonb_build_array((select id from t_cart where key = 'addon')))),
    'delivery',
    (select id from public.addresses where address_line = 'Cartweg 1'),
    null, 0, 'cash', false, false, gen_random_uuid(), null);

  select unit_price into v_price from public.order_items where order_id = v_order.id;

  perform pg_temp.assert(v_price = 14.75,
    'create_order prices a line exactly as validate_cart does');
  perform pg_temp.assert(
    (select (lines -> 0 ->> 'unit_price')::numeric
       from public.validate_cart(
         (select id from t_cart where key = 'restaurant'),
         jsonb_build_array(jsonb_build_object(
           'dish_id', (select id from t_cart where key = 'dish'),
           'quantity', 1,
           'addon_ids', jsonb_build_array((select id from t_cart where key = 'addon')))))) = v_price,
    'both functions agree on the unit price');

  update public.dishes set price = 12.00 where id = (select id from t_cart where key = 'dish');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  perform pg_temp.assert(
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'validate_cart'
         and has_function_privilege('anon', p.oid, 'EXECUTE')
    ),
    'validate_cart is not callable by anonymous visitors');

  perform pg_temp.assert(
    exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'validate_cart'
         and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ),
    'validate_cart stays callable by a signed in customer');

  perform pg_temp.assert(
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'price_cart_line'
         and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
              or has_function_privilege('anon', p.oid, 'EXECUTE'))
    ),
    'the shared pricing helper is reachable only with service credentials');

  perform pg_temp.assert(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'validate_cart') = 1,
    'validate_cart has no overload');

  perform pg_temp.assert(
    (select p.provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'validate_cart') = 's',
    'validate_cart is read only');

  set local role authenticated;
  perform pg_temp.act_as((select id from t_cart where key = 'customer'));
  begin
    perform public.price_cart_line(
      (select id from t_cart where key = 'restaurant'), pg_temp.items(12.00) -> 0);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a client cannot call the pricing helper directly');
  reset role;
end;
$$;

rollback;
