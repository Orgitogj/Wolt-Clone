do $$
begin
  if not exists (select 1 from pg_type where typname = 'delivery_status') then
    create type public.delivery_status as enum (
      'pending', 'assigned', 'picked_up', 'delivering', 'delivered', 'cancelled'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'delivery_offer_status') then
    create type public.delivery_offer_status as enum (
      'pending', 'accepted', 'rejected', 'expired'
    );
  end if;
end
$$;

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id),
  courier_id uuid references public.couriers (id) on delete set null,
  status public.delivery_status not null default 'pending',
  pickup_latitude double precision,
  pickup_longitude double precision,
  dropoff_latitude double precision,
  dropoff_longitude double precision,
  dropoff_address text,
  distance_km numeric(6,2),
  offer_attempts int not null default 0,
  assigned_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deliveries_status_idx on public.deliveries (status);
create index if not exists deliveries_courier_idx on public.deliveries (courier_id, status);
create index if not exists deliveries_restaurant_idx on public.deliveries (restaurant_id, status);

alter table public.deliveries enable row level security;

drop trigger if exists deliveries_set_updated_at on public.deliveries;
create trigger deliveries_set_updated_at
  before update on public.deliveries
  for each row execute function public.set_updated_at();

create table if not exists public.delivery_offers (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries (id) on delete cascade,
  courier_id uuid not null references public.couriers (id) on delete cascade,
  status public.delivery_offer_status not null default 'pending',
  rank int not null default 1,
  distance_km numeric(6,2),
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  unique (delivery_id, courier_id)
);

create index if not exists delivery_offers_courier_idx
  on public.delivery_offers (courier_id, status, expires_at desc);
create index if not exists delivery_offers_delivery_idx
  on public.delivery_offers (delivery_id, status);

alter table public.delivery_offers enable row level security;

create table if not exists public.courier_earnings (
  id uuid primary key default gen_random_uuid(),
  courier_id uuid not null references public.couriers (id) on delete cascade,
  delivery_id uuid not null unique references public.deliveries (id) on delete cascade,
  base_fee numeric(8,2) not null default 0,
  distance_fee numeric(8,2) not null default 0,
  tip numeric(8,2) not null default 0,
  total numeric(8,2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists courier_earnings_courier_idx
  on public.courier_earnings (courier_id, created_at desc);

alter table public.courier_earnings enable row level security;

create or replace function public.order_actor_role(p_order_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then 'system'
    when public.is_admin() then 'admin'
    when exists (
      select 1
        from public.orders o
        join public.restaurant_members m on m.restaurant_id = o.restaurant_id
       where o.id = p_order_id
         and m.user_id = auth.uid()
    ) then 'restaurant'
    when exists (
      select 1
        from public.deliveries d
       where d.order_id = p_order_id
         and d.courier_id = auth.uid()
    ) then 'courier'
    when exists (
      select 1 from public.orders o
       where o.id = p_order_id
         and o.user_id = auth.uid()
    ) then 'customer'
    else null
  end;
$$;

revoke all on function public.order_actor_role(uuid) from public;
grant execute on function public.order_actor_role(uuid) to authenticated;

insert into public.order_status_transitions (from_status, to_status, actor_role) values
  ('ready_for_pickup', 'courier_assigned', 'courier')
on conflict do nothing;

revoke insert, update, delete on public.deliveries from anon, authenticated;
revoke insert, update, delete on public.delivery_offers from anon, authenticated;
revoke insert, update, delete on public.courier_earnings from anon, authenticated;
