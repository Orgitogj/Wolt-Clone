

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  address_line text not null,
  city text,
  latitude double precision,
  longitude double precision,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists addresses_user_id_idx on public.addresses (user_id);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  image_url text,
  background_color text,
  sort_order int not null default 0
);

create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  image_url text,
  rating numeric(2,1) not null default 0,
  review_count int not null default 0,
  delivery_time_min int not null default 15,
  delivery_time_max int not null default 30,
  delivery_fee numeric(6,2) not null default 0,
  min_order numeric(6,2) not null default 0,
  address text,
  latitude double precision,
  longitude double precision,
  is_open boolean not null default true,
  cuisines text[] not null default '{}',
  tags text[] not null default '{}',
  opening_hours jsonb,
  created_at timestamptz not null default now()
);
create index if not exists restaurants_cuisines_idx on public.restaurants using gin (cuisines);
create index if not exists restaurants_name_idx on public.restaurants using gin (to_tsvector('simple', name || ' ' || coalesce(description, '')));

create table if not exists public.restaurant_categories (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  primary key (restaurant_id, category_id)
);

create table if not exists public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null,
  subtitle text,
  sort_order int not null default 0
);
create index if not exists menu_categories_restaurant_id_idx on public.menu_categories (restaurant_id);

create table if not exists public.dishes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  menu_category_id uuid not null references public.menu_categories (id) on delete cascade,
  name text not null,
  description text,
  price numeric(6,2) not null,
  image_url text,
  is_popular boolean not null default false,
  is_available boolean not null default true,
  dietary_tags text[] not null default '{}',
  sort_order int not null default 0
);
create index if not exists dishes_restaurant_id_idx on public.dishes (restaurant_id);
create index if not exists dishes_menu_category_id_idx on public.dishes (menu_category_id);

create table if not exists public.dish_addons (
  id uuid primary key default gen_random_uuid(),
  dish_id uuid not null references public.dishes (id) on delete cascade,
  name text not null,
  price_delta numeric(6,2) not null default 0,
  sort_order int not null default 0
);
create index if not exists dish_addons_dish_id_idx on public.dish_addons (dish_id);

create table if not exists public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, restaurant_id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id),
  status text not null default 'placed' check (status in ('placed', 'confirmed', 'preparing', 'on_the_way', 'delivered', 'cancelled')),
  delivery_mode text not null check (delivery_mode in ('delivery', 'pickup')),
  address_id uuid references public.addresses (id),
  scheduled_for timestamptz,
  subtotal numeric(8,2) not null,
  service_fee numeric(6,2) not null default 0,
  delivery_fee numeric(6,2) not null default 0,
  tip_amount numeric(6,2) not null default 0,
  total numeric(8,2) not null,
  payment_method text not null default 'card' check (payment_method in ('applepay', 'card')),
  leave_at_door boolean not null default false,
  send_as_gift boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists orders_user_id_idx on public.orders (user_id);
create index if not exists orders_restaurant_id_idx on public.orders (restaurant_id);

alter table public.orders add column if not exists send_as_gift boolean not null default false;

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  dish_id uuid references public.dishes (id),
  dish_name text not null,
  unit_price numeric(6,2) not null,
  quantity int not null default 1,
  addons jsonb not null default '[]',
  line_total numeric(8,2) not null
);
create index if not exists order_items_order_id_idx on public.order_items (order_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


alter table public.profiles enable row level security;
alter table public.addresses enable row level security;
alter table public.categories enable row level security;
alter table public.restaurants enable row level security;
alter table public.restaurant_categories enable row level security;
alter table public.menu_categories enable row level security;
alter table public.dishes enable row level security;
alter table public.dish_addons enable row level security;
alter table public.favorites enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "public read categories" on public.categories;
create policy "public read categories" on public.categories for select using (true);

drop policy if exists "public read restaurants" on public.restaurants;
create policy "public read restaurants" on public.restaurants for select using (true);

drop policy if exists "public read restaurant_categories" on public.restaurant_categories;
create policy "public read restaurant_categories" on public.restaurant_categories for select using (true);

drop policy if exists "public read menu_categories" on public.menu_categories;
create policy "public read menu_categories" on public.menu_categories for select using (true);

drop policy if exists "public read dishes" on public.dishes;
create policy "public read dishes" on public.dishes for select using (true);

drop policy if exists "public read dish_addons" on public.dish_addons;
create policy "public read dish_addons" on public.dish_addons for select using (true);


drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select using (auth.uid() = id);
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update using (auth.uid() = id);

drop policy if exists "own addresses" on public.addresses;
create policy "own addresses" on public.addresses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own favorites" on public.favorites;
create policy "own favorites" on public.favorites for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own orders" on public.orders;
create policy "own orders" on public.orders for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own order_items" on public.order_items;
create policy "own order_items" on public.order_items for all using (
  exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
) with check (
  exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
);


insert into storage.buckets (id, name, public)
values ('app-images', 'app-images', true)
on conflict (id) do nothing;

drop policy if exists "public read app-images" on storage.objects;
create policy "public read app-images" on storage.objects for select using (bucket_id = 'app-images');
