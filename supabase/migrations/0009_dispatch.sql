create or replace function public.create_delivery_for_order(p_order_id uuid)
returns public.deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_restaurant public.restaurants;
  v_address public.addresses;
  v_delivery public.deliveries;
  v_distance numeric(6,2);
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.delivery_mode <> 'delivery' then
    return null;
  end if;

  select * into v_delivery from public.deliveries where order_id = p_order_id;
  if found then
    return v_delivery;
  end if;

  select * into v_restaurant from public.restaurants where id = v_order.restaurant_id;
  select * into v_address from public.addresses where id = v_order.address_id;

  if v_restaurant.latitude is not null and v_restaurant.longitude is not null
     and v_address.latitude is not null and v_address.longitude is not null then
    v_distance := round(
      public.haversine_km(
        v_restaurant.latitude, v_restaurant.longitude,
        v_address.latitude, v_address.longitude
      )::numeric, 2);
  end if;

  insert into public.deliveries (
    order_id, restaurant_id, pickup_latitude, pickup_longitude,
    dropoff_latitude, dropoff_longitude, dropoff_address, distance_km
  )
  values (
    p_order_id, v_order.restaurant_id, v_restaurant.latitude, v_restaurant.longitude,
    v_address.latitude, v_address.longitude, v_address.address_line, v_distance
  )
  on conflict (order_id) do nothing
  returning * into v_delivery;

  if v_delivery.id is null then
    select * into v_delivery from public.deliveries where order_id = p_order_id;
    return v_delivery;
  end if;

  perform public.offer_next_delivery_candidate(v_delivery.id);
  return v_delivery;
end;
$$;

create or replace function public.expire_delivery_offers()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.delivery_offers
     set status = 'expired', responded_at = now()
   where status = 'pending'
     and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.offer_next_delivery_candidate(p_delivery_id uuid)
returns public.delivery_offers
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.platform_settings;
  v_delivery public.deliveries;
  v_courier_id uuid;
  v_distance double precision;
  v_offer public.delivery_offers;
  v_has_pickup boolean;
begin
  select * into s from public.platform_settings where id;

  select * into v_delivery from public.deliveries where id = p_delivery_id for update;
  if not found or v_delivery.status <> 'pending' then
    return null;
  end if;

  if exists (
    select 1 from public.delivery_offers
     where delivery_id = p_delivery_id
       and status = 'pending'
       and expires_at > now()
  ) then
    return null;
  end if;

  if v_delivery.offer_attempts >= s.max_delivery_offers then
    return null;
  end if;

  v_has_pickup := v_delivery.pickup_latitude is not null and v_delivery.pickup_longitude is not null;

  select c.id,
         case when v_has_pickup and c.current_latitude is not null
              then public.haversine_km(c.current_latitude, c.current_longitude,
                                       v_delivery.pickup_latitude, v_delivery.pickup_longitude)
         end
    into v_courier_id, v_distance
    from public.couriers c
   where c.availability = 'online'
     and c.verification_status = 'approved'
     and not exists (
       select 1 from public.delivery_offers o
        where o.delivery_id = p_delivery_id and o.courier_id = c.id
     )
     and not exists (
       select 1 from public.deliveries d
        where d.courier_id = c.id
          and d.status in ('assigned', 'picked_up', 'delivering')
     )
     and (
       not v_has_pickup
       or c.current_latitude is null
       or public.haversine_km(c.current_latitude, c.current_longitude,
                              v_delivery.pickup_latitude, v_delivery.pickup_longitude)
          <= s.courier_search_radius_km
     )
   order by
     case when v_has_pickup and c.current_latitude is not null
          then public.haversine_km(c.current_latitude, c.current_longitude,
                                   v_delivery.pickup_latitude, v_delivery.pickup_longitude)
          else 1e9 end asc,
     c.location_updated_at desc nulls last
   limit 1;

  if v_courier_id is null then
    return null;
  end if;

  insert into public.delivery_offers (delivery_id, courier_id, rank, distance_km, expires_at)
  values (
    p_delivery_id,
    v_courier_id,
    v_delivery.offer_attempts + 1,
    round(v_distance::numeric, 2),
    now() + make_interval(secs => s.delivery_offer_timeout_seconds)
  )
  returning * into v_offer;

  update public.deliveries
     set offer_attempts = offer_attempts + 1
   where id = p_delivery_id;

  return v_offer;
end;
$$;

create or replace function public.advance_dispatch()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery record;
  v_offered int := 0;
begin
  perform public.expire_delivery_offers();

  for v_delivery in
    select id from public.deliveries where status = 'pending' order by created_at asc limit 50
  loop
    if public.offer_next_delivery_candidate(v_delivery.id) is not null then
      v_offered := v_offered + 1;
    end if;
  end loop;

  return v_offered;
end;
$$;

create or replace function public.respond_to_delivery_offer(
  p_offer_id uuid,
  p_accept boolean
)
returns public.deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.delivery_offers;
  v_delivery public.deliveries;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in' using errcode = '28000';
  end if;

  if not p_accept then
    update public.delivery_offers
       set status = 'rejected', responded_at = now()
     where id = p_offer_id
       and courier_id = auth.uid()
       and status = 'pending'
     returning * into v_offer;

    if not found then
      raise exception 'This offer is no longer open' using errcode = '42501';
    end if;

    perform public.offer_next_delivery_candidate(v_offer.delivery_id);
    return null;
  end if;

  update public.delivery_offers
     set status = 'accepted', responded_at = now()
   where id = p_offer_id
     and courier_id = auth.uid()
     and status = 'pending'
     and expires_at > now()
   returning * into v_offer;

  if not found then
    raise exception 'This offer has expired' using errcode = '42501';
  end if;

  update public.deliveries
     set courier_id = auth.uid(),
         status = 'assigned',
         assigned_at = now()
   where id = v_offer.delivery_id
     and status = 'pending'
     and courier_id is null
   returning * into v_delivery;

  if not found then
    update public.delivery_offers set status = 'expired' where id = v_offer.id;
    raise exception 'Another courier already took this delivery' using errcode = '42501';
  end if;

  update public.delivery_offers
     set status = 'expired', responded_at = now()
   where delivery_id = v_delivery.id
     and status = 'pending';

  update public.couriers set availability = 'busy' where id = auth.uid();

  perform public.transition_order_status(v_delivery.order_id, 'courier_assigned');

  return v_delivery;
end;
$$;

create or replace function public.courier_advance_delivery(
  p_delivery_id uuid,
  p_to public.delivery_status
)
returns public.deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.platform_settings;
  v_delivery public.deliveries;
  v_order public.orders;
  v_base numeric(8,2);
  v_distance_fee numeric(8,2);
  v_tip numeric(8,2);
begin
  select * into v_delivery from public.deliveries where id = p_delivery_id for update;
  if not found or v_delivery.courier_id is distinct from auth.uid() then
    raise exception 'Delivery not found' using errcode = '42501';
  end if;

  if not (
    (v_delivery.status = 'assigned' and p_to = 'picked_up')
    or (v_delivery.status = 'picked_up' and p_to = 'delivering')
    or (v_delivery.status = 'delivering' and p_to = 'delivered')
  ) then
    raise exception 'Cannot move a delivery from % to %', v_delivery.status, p_to
      using errcode = '42501';
  end if;

  update public.deliveries
     set status = p_to,
         picked_up_at = case when p_to = 'picked_up' then now() else picked_up_at end,
         delivered_at = case when p_to = 'delivered' then now() else delivered_at end
   where id = p_delivery_id
   returning * into v_delivery;

  perform public.transition_order_status(
    v_delivery.order_id,
    case p_to
      when 'picked_up' then 'picked_up'::public.order_status
      when 'delivering' then 'delivering'::public.order_status
      else 'delivered'::public.order_status
    end
  );

  if p_to = 'delivered' then
    select * into s from public.platform_settings where id;
    select * into v_order from public.orders where id = v_delivery.order_id;

    v_base := s.courier_base_fee;
    v_distance_fee := round(coalesce(v_delivery.distance_km, 0) * s.courier_per_km_fee, 2);
    v_tip := coalesce(v_order.tip_amount, 0);

    insert into public.courier_earnings (courier_id, delivery_id, base_fee, distance_fee, tip, total)
    values (v_delivery.courier_id, v_delivery.id, v_base, v_distance_fee, v_tip,
            v_base + v_distance_fee + v_tip)
    on conflict (delivery_id) do nothing;

    update public.couriers set availability = 'online' where id = v_delivery.courier_id;
  end if;

  return v_delivery;
end;
$$;

create or replace function public.handle_order_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'ready_for_pickup'
     and old.status is distinct from new.status
     and new.delivery_mode = 'delivery' then
    perform public.create_delivery_for_order(new.id);
  end if;

  if new.status in ('cancelled', 'restaurant_rejected')
     and old.status is distinct from new.status then
    update public.deliveries
       set status = 'cancelled', cancelled_at = now()
     where order_id = new.id
       and status not in ('delivered', 'cancelled');

    update public.delivery_offers o
       set status = 'expired', responded_at = now()
      from public.deliveries d
     where d.id = o.delivery_id
       and d.order_id = new.id
       and o.status = 'pending';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_dispatch on public.orders;
create trigger orders_dispatch
  after update on public.orders
  for each row execute function public.handle_order_ready();

revoke all on function public.create_delivery_for_order(uuid) from public, anon, authenticated;
revoke all on function public.offer_next_delivery_candidate(uuid) from public, anon, authenticated;
revoke all on function public.expire_delivery_offers() from public, anon;
revoke all on function public.advance_dispatch() from public, anon;
revoke all on function public.respond_to_delivery_offer(uuid, boolean) from public, anon;
revoke all on function public.courier_advance_delivery(uuid, public.delivery_status) from public, anon;

grant execute on function public.advance_dispatch() to authenticated;
grant execute on function public.respond_to_delivery_offer(uuid, boolean) to authenticated;
grant execute on function public.courier_advance_delivery(uuid, public.delivery_status) to authenticated;
