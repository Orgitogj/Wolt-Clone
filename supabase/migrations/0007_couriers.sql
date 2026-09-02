do $$
begin
  if not exists (select 1 from pg_type where typname = 'courier_availability') then
    create type public.courier_availability as enum ('offline', 'online', 'busy');
  end if;
  if not exists (select 1 from pg_type where typname = 'verification_status') then
    create type public.verification_status as enum ('pending', 'approved', 'rejected', 'suspended');
  end if;
  if not exists (select 1 from pg_type where typname = 'courier_document_kind') then
    create type public.courier_document_kind as enum (
      'id_card', 'drivers_license', 'insurance', 'vehicle_registration'
    );
  end if;
end
$$;

create table if not exists public.couriers (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  phone text,
  vehicle_type text not null default 'bicycle'
    check (vehicle_type in ('bicycle', 'scooter', 'car', 'on_foot')),
  vehicle_plate text,
  availability public.courier_availability not null default 'offline',
  verification_status public.verification_status not null default 'pending',
  verification_notes text,
  current_latitude double precision,
  current_longitude double precision,
  location_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists couriers_dispatch_idx
  on public.couriers (availability, verification_status);

alter table public.couriers enable row level security;

drop trigger if exists couriers_set_updated_at on public.couriers;
create trigger couriers_set_updated_at
  before update on public.couriers
  for each row execute function public.set_updated_at();

create table if not exists public.courier_documents (
  id uuid primary key default gen_random_uuid(),
  courier_id uuid not null references public.couriers (id) on delete cascade,
  kind public.courier_document_kind not null,
  storage_path text not null,
  status public.verification_status not null default 'pending',
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique (courier_id, kind)
);

create index if not exists courier_documents_courier_id_idx
  on public.courier_documents (courier_id);

alter table public.courier_documents enable row level security;

alter table public.platform_settings
  add column if not exists delivery_offer_timeout_seconds int not null default 45
    check (delivery_offer_timeout_seconds > 0),
  add column if not exists courier_search_radius_km numeric(5,2) not null default 8.00
    check (courier_search_radius_km > 0),
  add column if not exists courier_base_fee numeric(6,2) not null default 2.00
    check (courier_base_fee >= 0),
  add column if not exists courier_per_km_fee numeric(6,2) not null default 0.40
    check (courier_per_km_fee >= 0),
  add column if not exists max_delivery_offers int not null default 5
    check (max_delivery_offers > 0);

create or replace function public.is_approved_courier(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.couriers c
     where c.id = p_user_id
       and c.verification_status = 'approved'
  );
$$;

create or replace function public.haversine_km(
  p_lat1 double precision,
  p_lon1 double precision,
  p_lat2 double precision,
  p_lon2 double precision
)
returns double precision
language sql
immutable
as $$
  select 6371 * 2 * atan2(
    sqrt(
      sin(radians(p_lat2 - p_lat1) / 2) ^ 2
      + cos(radians(p_lat1)) * cos(radians(p_lat2))
      * sin(radians(p_lon2 - p_lon1) / 2) ^ 2
    ),
    sqrt(
      1 - (
        sin(radians(p_lat2 - p_lat1) / 2) ^ 2
        + cos(radians(p_lat1)) * cos(radians(p_lat2))
        * sin(radians(p_lon2 - p_lon1) / 2) ^ 2
      )
    )
  );
$$;

create or replace function public.register_courier(
  p_full_name text,
  p_phone text,
  p_vehicle_type text,
  p_vehicle_plate text default null
)
returns public.couriers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_courier public.couriers;
begin
  if v_user_id is null then
    raise exception 'You must be signed in' using errcode = '28000';
  end if;

  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Please create an account first' using errcode = '42501';
  end if;

  if p_vehicle_type not in ('bicycle', 'scooter', 'car', 'on_foot') then
    raise exception 'Invalid vehicle type: %', p_vehicle_type using errcode = '22023';
  end if;

  if btrim(coalesce(p_full_name, '')) = '' then
    raise exception 'A full name is required' using errcode = '22023';
  end if;

  insert into public.couriers (id, full_name, phone, vehicle_type, vehicle_plate)
  values (v_user_id, btrim(p_full_name), nullif(btrim(coalesce(p_phone, '')), ''),
          p_vehicle_type, nullif(btrim(coalesce(p_vehicle_plate, '')), ''))
  on conflict (id) do update
    set full_name = excluded.full_name,
        phone = excluded.phone,
        vehicle_type = excluded.vehicle_type,
        vehicle_plate = excluded.vehicle_plate
  returning * into v_courier;

  return v_courier;
end;
$$;

create or replace function public.set_courier_availability(
  p_availability public.courier_availability
)
returns public.couriers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_courier public.couriers;
begin
  select * into v_courier from public.couriers where id = auth.uid();
  if not found then
    raise exception 'You are not registered as a courier' using errcode = '42501';
  end if;

  if v_courier.verification_status <> 'approved' and p_availability <> 'offline' then
    raise exception 'Your courier account is not approved yet' using errcode = '42501';
  end if;

  if p_availability = 'offline' and exists (
    select 1 from public.deliveries d
     where d.courier_id = v_courier.id
       and d.status in ('assigned', 'picked_up', 'delivering')
  ) then
    raise exception 'Finish your active delivery before going offline' using errcode = '42501';
  end if;

  update public.couriers
     set availability = p_availability
   where id = v_courier.id
   returning * into v_courier;

  return v_courier;
end;
$$;

create or replace function public.update_courier_location(
  p_latitude double precision,
  p_longitude double precision
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
   where id = auth.uid();

  if not found then
    raise exception 'You are not registered as a courier' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.is_approved_courier(uuid) from public;
revoke all on function public.register_courier(text, text, text, text) from public, anon;
revoke all on function public.set_courier_availability(public.courier_availability) from public, anon;
revoke all on function public.update_courier_location(double precision, double precision) from public, anon;

grant execute on function public.is_approved_courier(uuid) to authenticated;
grant execute on function public.register_courier(text, text, text, text) to authenticated;
grant execute on function public.set_courier_availability(public.courier_availability) to authenticated;
grant execute on function public.update_courier_location(double precision, double precision) to authenticated;

revoke insert, update, delete on public.couriers from anon, authenticated;
revoke update, delete on public.courier_documents from anon, authenticated;
