do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'cart_line_pricing'
  ) then
    create type public.cart_line_pricing as (
      dish_id uuid,
      dish_name text,
      quantity int,
      requested_addon_ids uuid[],
      dish_found boolean,
      is_available boolean,
      base_price numeric(8,2),
      addon_total numeric(8,2),
      unit_price numeric(8,2),
      addons jsonb,
      missing_addon_ids uuid[]
    );
  end if;
end
$$;

create or replace function public.price_cart_line(p_restaurant_id uuid, p_item jsonb)
returns public.cart_line_pricing
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.cart_line_pricing;
  v_dish public.dishes%rowtype;
begin
  v.quantity := coalesce((p_item ->> 'quantity')::int, 0);
  v.dish_id := (p_item ->> 'dish_id')::uuid;

  select coalesce(array_agg(value::uuid), '{}'::uuid[])
    into v.requested_addon_ids
    from jsonb_array_elements_text(coalesce(p_item -> 'addon_ids', '[]'::jsonb));

  select * into v_dish
    from public.dishes
   where id = v.dish_id
     and restaurant_id = p_restaurant_id;

  v.dish_found := found;

  if not v.dish_found then
    v.is_available := false;
    v.base_price := 0;
    v.addon_total := 0;
    v.unit_price := 0;
    v.addons := '[]'::jsonb;
    v.missing_addon_ids := v.requested_addon_ids;
    return v;
  end if;

  v.dish_name := v_dish.name;
  v.is_available := v_dish.is_available;
  v.base_price := v_dish.price;

  select coalesce(sum(price_delta), 0),
         coalesce(
           jsonb_agg(
             jsonb_build_object('id', id, 'name', name, 'priceDelta', price_delta)
             order by sort_order
           ),
           '[]'::jsonb
         )
    into v.addon_total, v.addons
    from public.dish_addons
   where dish_id = v_dish.id
     and id = any (v.requested_addon_ids);

  select coalesce(array_agg(requested), '{}'::uuid[])
    into v.missing_addon_ids
    from unnest(v.requested_addon_ids) as requested
   where not exists (
     select 1 from public.dish_addons da
      where da.dish_id = v_dish.id
        and da.id = requested
   );

  v.unit_price := v.base_price + v.addon_total;

  return v;
end;
$$;

create or replace function public.validate_cart(p_restaurant_id uuid, p_items jsonb)
returns table (
  restaurant_id uuid,
  restaurant_name text,
  is_open boolean,
  min_order numeric,
  currency text,
  max_item_quantity int,
  subtotal numeric,
  meets_min_order boolean,
  has_changes boolean,
  lines jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.platform_settings;
  v_restaurant public.restaurants;
  v_item jsonb;
  v_line public.cart_line_pricing;
  v_requested_unit_price numeric(8,2);
  v_quantity int;
  v_lines jsonb := '[]'::jsonb;
  v_subtotal numeric(10,2) := 0;
  v_changes boolean := false;
  v_quantity_valid boolean;
  v_price_changed boolean;
begin
  if p_items is not null and jsonb_typeof(p_items) <> 'array' then
    raise exception 'Cart items must be an array' using errcode = '22023';
  end if;

  select * into s from public.platform_settings where id;

  select * into v_restaurant from public.restaurants where id = p_restaurant_id;
  if not found then
    raise exception 'Restaurant not found' using errcode = '23503';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_line := public.price_cart_line(p_restaurant_id, v_item);
    v_quantity := v_line.quantity;
    v_quantity_valid := v_quantity > 0 and v_quantity <= s.max_item_quantity;

    v_requested_unit_price := case
      when v_item ? 'unit_price' then round((v_item ->> 'unit_price')::numeric, 2)
      else null
    end;

    v_price_changed :=
      v_line.dish_found
      and v_requested_unit_price is not null
      and v_requested_unit_price <> v_line.unit_price;

    if v_line.dish_found and v_line.is_available and v_quantity_valid then
      v_subtotal := v_subtotal + v_line.unit_price * v_quantity;
    end if;

    if not v_line.dish_found
       or not v_line.is_available
       or not v_quantity_valid
       or v_price_changed
       or coalesce(array_length(v_line.missing_addon_ids, 1), 0) > 0 then
      v_changes := true;
    end if;

    v_lines := v_lines || jsonb_build_object(
      'dish_id', v_line.dish_id,
      'dish_name', v_line.dish_name,
      'quantity', v_quantity,
      'dish_found', v_line.dish_found,
      'is_available', v_line.dish_found and v_line.is_available,
      'quantity_valid', v_quantity_valid,
      'base_price', v_line.base_price,
      'unit_price', v_line.unit_price,
      'requested_unit_price', v_requested_unit_price,
      'price_changed', v_price_changed,
      'addons', v_line.addons,
      'missing_addon_ids', to_jsonb(coalesce(v_line.missing_addon_ids, '{}'::uuid[])),
      'line_total', case
        when v_line.dish_found and v_line.is_available and v_quantity_valid
          then round(v_line.unit_price * v_quantity, 2)
        else 0
      end
    );
  end loop;

  return query
  select
    v_restaurant.id,
    v_restaurant.name,
    public.is_restaurant_open(v_restaurant.id, now()),
    v_restaurant.min_order,
    coalesce(s.currency, 'EUR'),
    s.max_item_quantity,
    round(v_subtotal, 2),
    round(v_subtotal, 2) >= v_restaurant.min_order,
    v_changes or not public.is_restaurant_open(v_restaurant.id, now()),
    v_lines;
end;
$$;

revoke all on function public.price_cart_line(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.validate_cart(uuid, jsonb) from public, anon;
grant execute on function public.validate_cart(uuid, jsonb) to authenticated;

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
  p_idempotency_key uuid default null,
  p_promo_code text default null
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
  v_line public.cart_line_pricing;
  v_quantity int;
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
  v_promotion public.promotions;
  v_discount numeric(8,2) := 0;
  v_promo_code text := nullif(upper(btrim(coalesce(p_promo_code, ''))), '');
  v_snapshot jsonb;
  v_global_count int;
  v_user_count int;
  v_status public.order_status;
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

  if p_payment_method <> 'cash' and not s.card_payments_enabled then
    raise exception 'Card payments are not available yet' using errcode = '22023';
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
    v_line := public.price_cart_line(p_restaurant_id, v_item);
    v_quantity := v_line.quantity;

    if v_quantity <= 0 or v_quantity > s.max_item_quantity then
      raise exception 'Invalid quantity: %', v_quantity using errcode = '22023';
    end if;

    if not v_line.dish_found or not v_line.is_available then
      raise exception 'A dish in your cart is no longer available' using errcode = '22023';
    end if;

    if coalesce(array_length(v_line.missing_addon_ids, 1), 0) > 0 then
      raise exception 'Unknown add-on for dish %', v_line.dish_name using errcode = '22023';
    end if;

    v_unit_price := v_line.unit_price;
    v_subtotal := v_subtotal + v_unit_price * v_quantity;

    v_lines := v_lines || jsonb_build_object(
      'dish_id', v_line.dish_id,
      'dish_name', v_line.dish_name,
      'unit_price', v_unit_price,
      'quantity', v_quantity,
      'addons', v_line.addons,
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

  if v_promo_code is not null then
    select * into v_promotion
      from public.promotions
     where upper(code) = v_promo_code
       for update;

    if not found or not v_promotion.is_active then
      raise exception 'That promo code is not valid' using errcode = '22023';
    end if;

    if v_promotion.starts_at is not null and v_promotion.starts_at > now() then
      raise exception 'That promo code is not active yet' using errcode = '22023';
    end if;

    if v_promotion.ends_at is not null and v_promotion.ends_at <= now() then
      raise exception 'That promo code has expired' using errcode = '22023';
    end if;

    if v_promotion.restaurant_id is not null and v_promotion.restaurant_id <> p_restaurant_id then
      raise exception 'That promo code does not apply to this restaurant' using errcode = '22023';
    end if;

    if round(v_subtotal, 2) < v_promotion.min_subtotal then
      raise exception 'That promo code needs a minimum order of %', v_promotion.min_subtotal
        using errcode = '22023';
    end if;

    if v_promotion.max_redemptions is not null then
      select count(*) into v_global_count
        from public.promotion_redemptions
       where promotion_id = v_promotion.id and state in ('reserved', 'consumed');
      if v_global_count >= v_promotion.max_redemptions then
        raise exception 'That promo code has been fully redeemed' using errcode = '22023';
      end if;
    end if;

    select count(*) into v_user_count
      from public.promotion_redemptions
     where promotion_id = v_promotion.id
       and user_id = v_user_id
       and state in ('reserved', 'consumed');

    if v_user_count >= v_promotion.max_per_customer then
      raise exception 'You have already used that promo code' using errcode = '22023';
    end if;

    v_discount := public.promotion_discount(v_promotion, round(v_subtotal, 2));

    v_snapshot := jsonb_build_object(
      'promotion_id', v_promotion.id,
      'code', v_promotion.code,
      'description', v_promotion.description,
      'discount_type', v_promotion.discount_type,
      'discount_value', v_promotion.discount_value,
      'max_discount', v_promotion.max_discount,
      'min_subtotal', v_promotion.min_subtotal,
      'eligible_subtotal', round(v_subtotal, 2),
      'discount_amount', v_discount,
      'applied_at', now()
    );
  end if;

  v_status := case
    when p_payment_method = 'cash' then 'placed'::public.order_status
    else 'pending_payment'::public.order_status
  end;

  begin
    insert into public.orders (
      user_id, restaurant_id, status, delivery_mode, address_id, scheduled_for,
      subtotal, service_fee, delivery_fee, tip_amount, total,
      payment_method, leave_at_door, send_as_gift, idempotency_key,
      promotion_id, promo_code, discount_amount, promotion_snapshot
    )
    values (
      v_user_id,
      p_restaurant_id,
      v_status,
      p_delivery_mode,
      case when p_delivery_mode = 'delivery' then p_address_id else null end,
      p_scheduled_for,
      v_subtotal,
      v_service_fee,
      v_delivery_fee,
      v_tip,
      round(v_subtotal + v_service_fee + v_delivery_fee + v_tip - v_discount, 2),
      p_payment_method,
      coalesce(p_leave_at_door, false),
      coalesce(p_send_as_gift, false),
      p_idempotency_key,
      v_promotion.id,
      case when v_promotion.id is not null then v_promotion.code else null end,
      v_discount,
      v_snapshot
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

  if v_promotion.id is not null then
    insert into public.promotion_redemptions (promotion_id, order_id, user_id, discount_amount)
    values (v_promotion.id, v_order.id, v_user_id, v_discount);
  end if;

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

  if v_status = 'pending_payment' then
    insert into public.payments (order_id, user_id, amount, currency)
    values (v_order.id, v_user_id, v_order.total, s.currency)
    on conflict (order_id) do nothing;
  else
    perform public.post_order_ledger(v_order.id, 'cash');
  end if;

  return v_order;
end;
$$;

revoke all on function public.create_order(
  uuid, jsonb, text, uuid, timestamptz, numeric, text, boolean, boolean, uuid, text)
  from public, anon;
grant execute on function public.create_order(
  uuid, jsonb, text, uuid, timestamptz, numeric, text, boolean, boolean, uuid, text)
  to authenticated;
