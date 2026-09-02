alter table public.orders add column if not exists idempotency_key uuid;

create unique index if not exists orders_user_idempotency_key_idx
  on public.orders (user_id, idempotency_key)
  where idempotency_key is not null;

drop function if exists public.create_order(uuid, jsonb, text, uuid, timestamptz, numeric, text, boolean, boolean);

create or replace function public.create_order(
  p_restaurant_id uuid,
  p_items jsonb,
  p_delivery_mode text,
  p_address_id uuid default null,
  p_scheduled_for timestamptz default null,
  p_tip_amount numeric default 0,
  p_payment_method text default 'card',
  p_leave_at_door boolean default false,
  p_send_as_gift boolean default false,
  p_idempotency_key uuid default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.platform_settings;
  v_user_id uuid := auth.uid();
  v_is_anonymous boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  v_order public.orders;
  v_restaurant public.restaurants;
  v_item jsonb;
  v_dish public.dishes%rowtype;
  v_quantity int;
  v_addon_ids uuid[];
  v_addon_count int;
  v_addon_total numeric(8,2);
  v_addons jsonb;
  v_unit_price numeric(8,2);
  v_lines jsonb := '[]'::jsonb;
  v_subtotal numeric(10,2) := 0;
  v_tip numeric(8,2);
  v_service_fee numeric(6,2) := 0;
  v_delivery_fee numeric(6,2) := 0;
  v_distance_km numeric;
  v_from_lat double precision;
  v_from_lon double precision;
  v_haversine double precision;
  v_effective_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to place an order' using errcode = '28000';
  end if;

  if v_is_anonymous then
    raise exception 'Please create an account to place an order' using errcode = '42501';
  end if;

  if p_idempotency_key is not null then
    select * into v_order
      from public.orders
     where user_id = v_user_id
       and idempotency_key = p_idempotency_key;
    if found then
      return v_order;
    end if;
  end if;

  select * into s from public.platform_settings where id;

  if p_delivery_mode not in ('delivery', 'pickup') then
    raise exception 'Invalid delivery mode: %', p_delivery_mode using errcode = '22023';
  end if;

  if p_payment_method not in ('applepay', 'card', 'cash') then
    raise exception 'Invalid payment method: %', p_payment_method using errcode = '22023';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'An order needs at least one item' using errcode = '22023';
  end if;

  v_effective_at := coalesce(p_scheduled_for, now());

  if p_scheduled_for is not null then
    if p_scheduled_for < now() - make_interval(mins => s.scheduling_grace_minutes) then
      raise exception 'Scheduled delivery time is in the past' using errcode = '22023';
    end if;
    if p_scheduled_for > now() + make_interval(days => s.max_schedule_days_ahead) then
      raise exception 'Orders can be scheduled at most % days ahead', s.max_schedule_days_ahead
        using errcode = '22023';
    end if;
  end if;

  select * into v_restaurant from public.restaurants where id = p_restaurant_id;
  if not found then
    raise exception 'Restaurant not found' using errcode = '23503';
  end if;

  if not public.is_restaurant_open(p_restaurant_id, v_effective_at) then
    raise exception '% is closed at the selected time', v_restaurant.name using errcode = '22023';
  end if;

  if p_delivery_mode = 'delivery' then
    if p_address_id is null then
      raise exception 'A delivery address is required' using errcode = '22023';
    end if;

    select latitude, longitude
      into v_from_lat, v_from_lon
      from public.addresses
     where id = p_address_id
       and user_id = v_user_id;

    if not found then
      raise exception 'Delivery address not found' using errcode = '42501';
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := coalesce((v_item ->> 'quantity')::int, 0);
    if v_quantity <= 0 or v_quantity > s.max_item_quantity then
      raise exception 'Invalid quantity: %', v_quantity using errcode = '22023';
    end if;

    select *
      into v_dish
      from public.dishes
     where id = (v_item ->> 'dish_id')::uuid
       and restaurant_id = p_restaurant_id
       and is_available;

    if not found then
      raise exception 'A dish in your cart is no longer available' using errcode = '22023';
    end if;

    select coalesce(array_agg(value::uuid), '{}'::uuid[])
      into v_addon_ids
      from jsonb_array_elements_text(coalesce(v_item -> 'addon_ids', '[]'::jsonb));

    select coalesce(sum(price_delta), 0),
           coalesce(
             jsonb_agg(
               jsonb_build_object('id', id, 'name', name, 'priceDelta', price_delta)
               order by sort_order
             ),
             '[]'::jsonb
           ),
           count(*)
      into v_addon_total, v_addons, v_addon_count
      from public.dish_addons
     where dish_id = v_dish.id
       and id = any (v_addon_ids);

    if v_addon_count <> coalesce(array_length(v_addon_ids, 1), 0) then
      raise exception 'Unknown add-on for dish %', v_dish.name using errcode = '22023';
    end if;

    v_unit_price := v_dish.price + v_addon_total;
    v_subtotal := v_subtotal + v_unit_price * v_quantity;

    v_lines := v_lines || jsonb_build_object(
      'dish_id', v_dish.id,
      'dish_name', v_dish.name,
      'unit_price', v_unit_price,
      'quantity', v_quantity,
      'addons', v_addons,
      'line_total', v_unit_price * v_quantity
    );
  end loop;

  if v_subtotal < v_restaurant.min_order then
    raise exception 'Minimum order for % is %', v_restaurant.name, v_restaurant.min_order
      using errcode = '22023';
  end if;

  v_service_fee := s.service_fee;

  if p_delivery_mode = 'delivery' then
    v_distance_km := s.fallback_distance_km;

    if v_from_lat is not null and v_from_lon is not null
       and v_restaurant.latitude is not null and v_restaurant.longitude is not null then
      v_haversine :=
        sin(radians(v_restaurant.latitude - v_from_lat) / 2) ^ 2
        + cos(radians(v_from_lat)) * cos(radians(v_restaurant.latitude))
        * sin(radians(v_restaurant.longitude - v_from_lon) / 2) ^ 2;
      v_distance_km := 6371 * 2 * atan2(sqrt(v_haversine), sqrt(1 - v_haversine));

      if v_distance_km > s.max_delivery_distance_km then
        raise exception '% does not deliver to that address', v_restaurant.name
          using errcode = '22023';
      end if;
    end if;

    v_delivery_fee := round(
      (case
         when v_distance_km <= s.delivery_base_distance_km then s.delivery_base_fee
         else s.delivery_base_fee + (v_distance_km - s.delivery_base_distance_km) * s.delivery_per_km_fee
       end)::numeric,
      2
    );
  end if;

  v_tip := round(greatest(coalesce(p_tip_amount, 0), 0), 2);
  if v_tip > s.max_tip then
    raise exception 'Tip amount is too large' using errcode = '22023';
  end if;

  begin
    insert into public.orders (
      user_id, restaurant_id, status, delivery_mode, address_id, scheduled_for,
      subtotal, service_fee, delivery_fee, tip_amount, total,
      payment_method, leave_at_door, send_as_gift, idempotency_key
    )
    values (
      v_user_id,
      p_restaurant_id,
      'placed',
      p_delivery_mode,
      case when p_delivery_mode = 'delivery' then p_address_id else null end,
      p_scheduled_for,
      v_subtotal,
      v_service_fee,
      v_delivery_fee,
      v_tip,
      v_subtotal + v_service_fee + v_delivery_fee + v_tip,
      p_payment_method,
      coalesce(p_leave_at_door, false),
      coalesce(p_send_as_gift, false),
      p_idempotency_key
    )
    returning * into v_order;
  exception when unique_violation then
    if p_idempotency_key is null then
      raise;
    end if;
    select * into v_order
      from public.orders
     where user_id = v_user_id
       and idempotency_key = p_idempotency_key;
    if not found then
      raise;
    end if;
    return v_order;
  end;

  insert into public.order_items (
    order_id, dish_id, dish_name, unit_price, quantity, addons, line_total
  )
  select v_order.id,
         (line ->> 'dish_id')::uuid,
         line ->> 'dish_name',
         (line ->> 'unit_price')::numeric,
         (line ->> 'quantity')::int,
         line -> 'addons',
         (line ->> 'line_total')::numeric
    from jsonb_array_elements(v_lines) as line;

  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_role)
  values (v_order.id, null, v_order.status, v_user_id, 'customer');

  return v_order;
end;
$$;

revoke all on function public.create_order(
  uuid, jsonb, text, uuid, timestamptz, numeric, text, boolean, boolean, uuid
) from public, anon;

grant execute on function public.create_order(
  uuid, jsonb, text, uuid, timestamptz, numeric, text, boolean, boolean, uuid
) to authenticated;

create or replace function public.quote_order_fees(
  p_restaurant_id uuid,
  p_delivery_mode text,
  p_address_id uuid default null
)
returns table (service_fee numeric, delivery_fee numeric, distance_km numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.platform_settings;
  v_restaurant public.restaurants;
  v_from_lat double precision;
  v_from_lon double precision;
  v_haversine double precision;
  v_distance numeric;
begin
  select * into s from public.platform_settings where id;
  select * into v_restaurant from public.restaurants where id = p_restaurant_id;

  if not found or p_delivery_mode <> 'delivery' then
    return query select s.service_fee, 0::numeric, 0::numeric;
    return;
  end if;

  v_distance := s.fallback_distance_km;

  select latitude, longitude into v_from_lat, v_from_lon
    from public.addresses
   where id = p_address_id and user_id = auth.uid();

  if v_from_lat is not null and v_from_lon is not null
     and v_restaurant.latitude is not null and v_restaurant.longitude is not null then
    v_haversine :=
      sin(radians(v_restaurant.latitude - v_from_lat) / 2) ^ 2
      + cos(radians(v_from_lat)) * cos(radians(v_restaurant.latitude))
      * sin(radians(v_restaurant.longitude - v_from_lon) / 2) ^ 2;
    v_distance := 6371 * 2 * atan2(sqrt(v_haversine), sqrt(1 - v_haversine));
  end if;

  return query select
    s.service_fee,
    round((case
      when v_distance <= s.delivery_base_distance_km then s.delivery_base_fee
      else s.delivery_base_fee + (v_distance - s.delivery_base_distance_km) * s.delivery_per_km_fee
    end)::numeric, 2),
    round(v_distance, 2);
end;
$$;

revoke all on function public.quote_order_fees(uuid, text, uuid) from public, anon;
grant execute on function public.quote_order_fees(uuid, text, uuid) to authenticated;
