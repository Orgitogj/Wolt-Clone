create table if not exists public.platform_settings (
  id boolean primary key default true check (id),
  currency text not null default 'EUR',
  service_fee numeric(6,2) not null default 0.83 check (service_fee >= 0),
  delivery_base_fee numeric(6,2) not null default 1.90 check (delivery_base_fee >= 0),
  delivery_base_distance_km numeric(5,2) not null default 3.00 check (delivery_base_distance_km >= 0),
  delivery_per_km_fee numeric(6,2) not null default 0.50 check (delivery_per_km_fee >= 0),
  fallback_distance_km numeric(5,2) not null default 2.50 check (fallback_distance_km >= 0),
  max_delivery_distance_km numeric(5,2) not null default 15.00 check (max_delivery_distance_km > 0),
  max_tip numeric(8,2) not null default 1000 check (max_tip >= 0),
  max_item_quantity int not null default 99 check (max_item_quantity > 0),
  scheduling_grace_minutes int not null default 5 check (scheduling_grace_minutes >= 0),
  max_schedule_days_ahead int not null default 7 check (max_schedule_days_ahead > 0),
  default_timezone text not null default 'Europe/Berlin',
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

alter table public.restaurants add column if not exists timezone text;

create table if not exists public.restaurant_hours (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  created_at timestamptz not null default now(),
  unique (restaurant_id, day_of_week, opens_at)
);
create index if not exists restaurant_hours_restaurant_id_idx
  on public.restaurant_hours (restaurant_id, day_of_week);

alter table public.restaurant_hours enable row level security;

insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at)
select r.id,
       d.dow,
       split_part(r.opening_hours ->> d.day_name, '-', 1)::time,
       split_part(r.opening_hours ->> d.day_name, '-', 2)::time
  from public.restaurants r
  cross join (values
    (0, 'sunday'), (1, 'monday'), (2, 'tuesday'), (3, 'wednesday'),
    (4, 'thursday'), (5, 'friday'), (6, 'saturday')
  ) as d(dow, day_name)
 where r.opening_hours is not null
   and r.opening_hours ->> d.day_name ~ '^[0-9]{2}:[0-9]{2}-[0-9]{2}:[0-9]{2}$'
on conflict (restaurant_id, day_of_week, opens_at) do nothing;

create or replace function public.is_restaurant_open(
  p_restaurant_id uuid,
  p_at timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_is_open boolean;
  v_timezone text;
  v_local timestamp;
  v_dow int;
  v_time time;
  v_has_hours boolean;
begin
  select r.is_open, coalesce(r.timezone, s.default_timezone)
    into v_is_open, v_timezone
    from public.restaurants r
    cross join public.platform_settings s
   where r.id = p_restaurant_id;

  if not found or not v_is_open then
    return false;
  end if;

  select exists (select 1 from public.restaurant_hours where restaurant_id = p_restaurant_id)
    into v_has_hours;

  if not v_has_hours then
    return true;
  end if;

  v_local := p_at at time zone v_timezone;
  v_dow := extract(dow from v_local)::int;
  v_time := v_local::time;

  return exists (
    select 1
      from public.restaurant_hours h
     where h.restaurant_id = p_restaurant_id
       and (
         (h.closes_at > h.opens_at
           and h.day_of_week = v_dow
           and v_time >= h.opens_at
           and v_time < h.closes_at)
         or (h.closes_at <= h.opens_at
           and (
             (h.day_of_week = v_dow and v_time >= h.opens_at)
             or (h.day_of_week = (v_dow + 6) % 7 and v_time < h.closes_at)
           ))
       )
  );
end;
$$;

revoke all on function public.is_restaurant_open(uuid, timestamptz) from public;
grant execute on function public.is_restaurant_open(uuid, timestamptz) to anon, authenticated;

revoke insert, update, delete on public.platform_settings from anon, authenticated;
