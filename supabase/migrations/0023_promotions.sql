create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  description text,
  discount_type text not null check (discount_type in ('percentage', 'fixed')),
  discount_value numeric(8,2) not null check (discount_value > 0),
  max_discount numeric(8,2) check (max_discount is null or max_discount > 0),
  min_subtotal numeric(8,2) not null default 0 check (min_subtotal >= 0),
  restaurant_id uuid references public.restaurants (id) on delete cascade,
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions int check (max_redemptions is null or max_redemptions > 0),
  max_per_customer int not null default 1 check (max_per_customer > 0),
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotions_percentage_bounds
    check (discount_type <> 'percentage' or discount_value <= 100),
  constraint promotions_window check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create unique index if not exists promotions_code_idx on public.promotions (upper(code));
create index if not exists promotions_active_idx
  on public.promotions (is_active, starts_at, ends_at);

create table if not exists public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions (id) on delete cascade,
  order_id uuid not null unique references public.orders (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  discount_amount numeric(8,2) not null check (discount_amount >= 0),
  state text not null default 'reserved' check (state in ('reserved', 'consumed', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists promotion_redemptions_promotion_idx
  on public.promotion_redemptions (promotion_id, state);
create index if not exists promotion_redemptions_user_idx
  on public.promotion_redemptions (promotion_id, user_id, state);

alter table public.orders add column if not exists promotion_id uuid
  references public.promotions (id) on delete set null;
alter table public.orders add column if not exists promo_code text;
alter table public.orders add column if not exists discount_amount numeric(8,2) not null default 0;
alter table public.orders add column if not exists promotion_snapshot jsonb;

alter table public.promotions enable row level security;
alter table public.promotion_redemptions enable row level security;

revoke all on public.promotions from anon, authenticated;
revoke all on public.promotion_redemptions from anon, authenticated;
grant select on public.promotions to anon, authenticated;
grant select on public.promotion_redemptions to authenticated;

drop policy if exists "read active promotions" on public.promotions;
create policy "read active promotions" on public.promotions
  for select using (
    public.is_admin()
    or (
      is_active
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at > now())
    )
  );

drop policy if exists "read own redemptions" on public.promotion_redemptions;
create policy "read own redemptions" on public.promotion_redemptions
  for select using (user_id = auth.uid() or public.is_admin());

create or replace function public.promotion_discount(
  p_promotion public.promotions,
  p_subtotal numeric
)
returns numeric
language sql
immutable
as $$
  select greatest(
    0,
    least(
      round(
        case
          when p_promotion.discount_type = 'percentage'
            then least(
              p_subtotal * p_promotion.discount_value / 100,
              coalesce(p_promotion.max_discount, p_subtotal)
            )
          else p_promotion.discount_value
        end,
        2
      ),
      round(p_subtotal, 2)
    )
  );
$$;

create or replace function public.evaluate_promotion(
  p_code text,
  p_restaurant_id uuid,
  p_subtotal numeric
)
returns table (
  valid boolean,
  reason text,
  discount_amount numeric,
  promotion_id uuid,
  description text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_promotion public.promotions;
  v_user_id uuid := auth.uid();
  v_global_count int;
  v_user_count int;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if v_user_id is null then
    return query select false, 'not_signed_in', 0::numeric, null::uuid, null::text;
    return;
  end if;

  if v_code = '' then
    return query select false, 'not_found', 0::numeric, null::uuid, null::text;
    return;
  end if;

  select * into v_promotion from public.promotions where upper(code) = v_code;

  if not found or not v_promotion.is_active then
    return query select false, 'not_found', 0::numeric, null::uuid, null::text;
    return;
  end if;

  if v_promotion.starts_at is not null and v_promotion.starts_at > now() then
    return query select false, 'not_started', 0::numeric, v_promotion.id, v_promotion.description;
    return;
  end if;

  if v_promotion.ends_at is not null and v_promotion.ends_at <= now() then
    return query select false, 'expired', 0::numeric, v_promotion.id, v_promotion.description;
    return;
  end if;

  if v_promotion.restaurant_id is not null and v_promotion.restaurant_id <> p_restaurant_id then
    return query select false, 'wrong_restaurant', 0::numeric, v_promotion.id, v_promotion.description;
    return;
  end if;

  if round(coalesce(p_subtotal, 0), 2) < v_promotion.min_subtotal then
    return query select false, 'below_minimum', 0::numeric, v_promotion.id, v_promotion.description;
    return;
  end if;

  if v_promotion.max_redemptions is not null then
    select count(*) into v_global_count
      from public.promotion_redemptions pr
     where pr.promotion_id = v_promotion.id and pr.state in ('reserved', 'consumed');
    if v_global_count >= v_promotion.max_redemptions then
      return query select false, 'fully_redeemed', 0::numeric, v_promotion.id, v_promotion.description;
      return;
    end if;
  end if;

  select count(*) into v_user_count
    from public.promotion_redemptions pr
   where pr.promotion_id = v_promotion.id
     and pr.user_id = v_user_id
     and pr.state in ('reserved', 'consumed');

  if v_user_count >= v_promotion.max_per_customer then
    return query select false, 'already_used', 0::numeric, v_promotion.id, v_promotion.description;
    return;
  end if;

  return query
    select
      true,
      'eligible',
      public.promotion_discount(v_promotion, round(coalesce(p_subtotal, 0), 2)),
      v_promotion.id,
      v_promotion.description;
end;
$$;

create or replace function public.active_promotions(p_restaurant_id uuid default null)
returns setof public.promotions
language sql
stable
set search_path = public
as $$
  select *
    from public.promotions
   where is_active
     and (starts_at is null or starts_at <= now())
     and (ends_at is null or ends_at > now())
     and (
       p_restaurant_id is null
       or restaurant_id is null
       or restaurant_id = p_restaurant_id
     )
     and (
       max_redemptions is null
       or max_redemptions > (
         select count(*) from public.promotion_redemptions pr
          where pr.promotion_id = promotions.id and pr.state in ('reserved', 'consumed')
       )
     )
   order by coalesce(ends_at, 'infinity'::timestamptz), code;
$$;

create or replace function public.promotion_redemption_state(p_order_status text)
returns text
language sql
immutable
as $$
  select case
    when p_order_status in ('cancelled', 'payment_failed', 'restaurant_rejected') then 'released'
    when p_order_status = 'delivered' then 'consumed'
    else null
  end;
$$;

create or replace function public.promotion_redemptions_follow_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_state text;
begin
  v_state := public.promotion_redemption_state(new.status::text);

  if v_state is null then
    return new;
  end if;

  update public.promotion_redemptions
     set state = v_state,
         updated_at = now()
   where order_id = new.id
     and state <> v_state
     and state <> 'consumed';

  return new;
end;
$$;

drop trigger if exists promotion_redemptions_follow_order on public.orders;
create trigger promotion_redemptions_follow_order
  after update of status on public.orders
  for each row execute function public.promotion_redemptions_follow_order();

drop function if exists public.create_order(uuid, jsonb, text, uuid, timestamptz, numeric, text, boolean, boolean, uuid);

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
  uuid, jsonb, text, uuid, timestamptz, numeric, text, boolean, boolean, uuid, text
) from public, anon;

grant execute on function public.create_order(
  uuid, jsonb, text, uuid, timestamptz, numeric, text, boolean, boolean, uuid, text
) to authenticated;

create or replace function public.admin_save_promotion(
  p_id uuid,
  p_code text,
  p_description text,
  p_discount_type text,
  p_discount_value numeric,
  p_max_discount numeric default null,
  p_min_subtotal numeric default 0,
  p_restaurant_id uuid default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_max_redemptions int default null,
  p_max_per_customer int default 1,
  p_is_active boolean default true
)
returns public.promotions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_promotion public.promotions;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  perform public.require_admin();

  if v_code = '' then
    raise exception 'A promo code is required' using errcode = '22023';
  end if;

  if p_discount_type not in ('percentage', 'fixed') then
    raise exception 'Unknown discount type' using errcode = '22023';
  end if;

  if p_discount_value is null or p_discount_value <= 0 then
    raise exception 'The discount value must be greater than zero' using errcode = '22023';
  end if;

  if p_discount_type = 'percentage' and p_discount_value > 100 then
    raise exception 'A percentage discount cannot be more than 100' using errcode = '22023';
  end if;

  if p_max_discount is not null and p_max_discount <= 0 then
    raise exception 'The maximum discount must be greater than zero' using errcode = '22023';
  end if;

  if coalesce(p_min_subtotal, 0) < 0 then
    raise exception 'The minimum basket cannot be negative' using errcode = '22023';
  end if;

  if p_max_redemptions is not null and p_max_redemptions < 1 then
    raise exception 'Total uses must be at least one' using errcode = '22023';
  end if;

  if coalesce(p_max_per_customer, 1) < 1 then
    raise exception 'Uses per customer must be at least one' using errcode = '22023';
  end if;

  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'The end of a promotion must be later than its start' using errcode = '22023';
  end if;

  if p_restaurant_id is not null
     and not exists (select 1 from public.restaurants where id = p_restaurant_id) then
    raise exception 'Restaurant not found' using errcode = '23503';
  end if;

  if p_id is null then
    insert into public.promotions (
      code, description, discount_type, discount_value, max_discount, min_subtotal,
      restaurant_id, starts_at, ends_at, max_redemptions, max_per_customer, is_active, created_by
    )
    values (
      v_code, nullif(btrim(coalesce(p_description, '')), ''), p_discount_type, p_discount_value,
      p_max_discount, coalesce(p_min_subtotal, 0), p_restaurant_id, p_starts_at, p_ends_at,
      p_max_redemptions, coalesce(p_max_per_customer, 1), coalesce(p_is_active, true), auth.uid()
    )
    returning * into v_promotion;
  else
    update public.promotions
       set code = v_code,
           description = nullif(btrim(coalesce(p_description, '')), ''),
           discount_type = p_discount_type,
           discount_value = p_discount_value,
           max_discount = p_max_discount,
           min_subtotal = coalesce(p_min_subtotal, 0),
           restaurant_id = p_restaurant_id,
           starts_at = p_starts_at,
           ends_at = p_ends_at,
           max_redemptions = p_max_redemptions,
           max_per_customer = coalesce(p_max_per_customer, 1),
           is_active = coalesce(p_is_active, true),
           updated_at = now()
     where id = p_id
    returning * into v_promotion;

    if v_promotion.id is null then
      raise exception 'Promotion not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.admin_actions (admin_id, action, subject_type, subject_id, details)
  values (
    auth.uid(),
    case when p_id is null then 'create_promotion' else 'update_promotion' end,
    'promotion',
    v_promotion.id::text,
    jsonb_build_object('code', v_promotion.code, 'is_active', v_promotion.is_active)
  );

  return v_promotion;
end;
$$;

create or replace function public.admin_set_promotion_active(p_id uuid, p_is_active boolean)
returns public.promotions
language plpgsql
security definer
set search_path = public
as $$
declare v_promotion public.promotions;
begin
  perform public.require_admin();

  update public.promotions
     set is_active = coalesce(p_is_active, false), updated_at = now()
   where id = p_id
  returning * into v_promotion;

  if v_promotion.id is null then
    raise exception 'Promotion not found' using errcode = 'P0002';
  end if;

  insert into public.admin_actions (admin_id, action, subject_type, subject_id, details)
  values (
    auth.uid(),
    case when coalesce(p_is_active, false) then 'activate_promotion' else 'deactivate_promotion' end,
    'promotion',
    p_id::text,
    jsonb_build_object('code', v_promotion.code)
  );

  return v_promotion;
end;
$$;

create or replace function public.admin_promotions()
returns table (
  id uuid,
  code text,
  description text,
  discount_type text,
  discount_value numeric,
  max_discount numeric,
  min_subtotal numeric,
  restaurant_id uuid,
  restaurant_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions int,
  max_per_customer int,
  is_active boolean,
  redeemed_count int,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id, p.code, p.description, p.discount_type, p.discount_value, p.max_discount,
    p.min_subtotal, p.restaurant_id, r.name as restaurant_name, p.starts_at, p.ends_at,
    p.max_redemptions, p.max_per_customer, p.is_active,
    (
      select count(*)::int from public.promotion_redemptions pr
       where pr.promotion_id = p.id and pr.state in ('reserved', 'consumed')
    ) as redeemed_count,
    p.created_at
  from public.promotions p
  left join public.restaurants r on r.id = p.restaurant_id
 where public.is_admin()
 order by p.created_at desc;
$$;

revoke all on function public.evaluate_promotion(text, uuid, numeric) from public, anon;
revoke all on function public.admin_save_promotion(
  uuid, text, text, text, numeric, numeric, numeric, uuid, timestamptz, timestamptz, int, int, boolean
) from public, anon;
revoke all on function public.admin_set_promotion_active(uuid, boolean) from public, anon;
revoke all on function public.admin_promotions() from public, anon;
revoke all on function public.promotion_discount(public.promotions, numeric) from public;
revoke all on function public.active_promotions(uuid) from public;
revoke all on function public.promotion_redemption_state(text) from public, anon;

grant execute on function public.promotion_discount(public.promotions, numeric) to anon, authenticated;
grant execute on function public.evaluate_promotion(text, uuid, numeric) to authenticated;
grant execute on function public.active_promotions(uuid) to anon, authenticated;
grant execute on function public.promotion_redemption_state(text) to authenticated;
grant execute on function public.admin_save_promotion(
  uuid, text, text, text, numeric, numeric, numeric, uuid, timestamptz, timestamptz, int, int, boolean
) to authenticated;
grant execute on function public.admin_set_promotion_active(uuid, boolean) to authenticated;
grant execute on function public.admin_promotions() to authenticated;
