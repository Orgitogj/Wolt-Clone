create table if not exists public.courier_locations (
  id bigint generated always as identity primary key,
  courier_id uuid not null references public.couriers (id) on delete cascade,
  delivery_id uuid not null references public.deliveries (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m real,
  heading real,
  speed_mps real,
  recorded_at timestamptz not null default now()
);

create index if not exists courier_locations_delivery_idx
  on public.courier_locations (delivery_id, recorded_at desc);
create index if not exists courier_locations_recorded_idx
  on public.courier_locations (recorded_at);

alter table public.courier_locations enable row level security;

create or replace function public.record_courier_location(
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m real default null,
  p_heading real default null,
  p_speed_mps real default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_courier_id uuid := auth.uid();
  v_delivery_id uuid;
begin
  if p_latitude is null or p_longitude is null
     or p_latitude < -90 or p_latitude > 90
     or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Invalid coordinates' using errcode = '22023';
  end if;

  update public.couriers
     set current_latitude = p_latitude,
         current_longitude = p_longitude,
         location_updated_at = now()
   where id = v_courier_id;

  if not found then
    raise exception 'You are not registered as a courier' using errcode = '42501';
  end if;

  select id into v_delivery_id
    from public.deliveries
   where courier_id = v_courier_id
     and status in ('assigned', 'picked_up', 'delivering')
   order by assigned_at desc
   limit 1;

  if v_delivery_id is null then
    return null;
  end if;

  insert into public.courier_locations (
    courier_id, delivery_id, latitude, longitude, accuracy_m, heading, speed_mps
  )
  values (
    v_courier_id, v_delivery_id, p_latitude, p_longitude, p_accuracy_m, p_heading, p_speed_mps
  );

  return v_delivery_id;
end;
$$;

create or replace function public.prune_courier_locations(p_keep_days int default 30)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.courier_locations
   where recorded_at < now() - make_interval(days => greatest(p_keep_days, 1));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

drop policy if exists "read delivery locations" on public.courier_locations;
create policy "read delivery locations" on public.courier_locations
  for select using (
    courier_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1
        from public.deliveries d
        join public.orders o on o.id = d.order_id
       where d.id = courier_locations.delivery_id
         and d.status in ('assigned', 'picked_up', 'delivering')
         and (o.user_id = auth.uid() or public.manages_restaurant(d.restaurant_id))
    )
  );

revoke all on function public.record_courier_location(
  double precision, double precision, real, real, real
) from public, anon;
grant execute on function public.record_courier_location(
  double precision, double precision, real, real, real
) to authenticated;

revoke all on function public.prune_courier_locations(int) from public, anon, authenticated;

revoke insert, update, delete on public.courier_locations from anon, authenticated;
