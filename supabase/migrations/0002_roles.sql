do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('customer', 'courier', 'admin');
  end if;
end
$$;

alter table public.profiles
  add column if not exists role public.user_role not null default 'customer';

create index if not exists profiles_role_idx on public.profiles (role);

create table if not exists public.restaurant_members (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);
create index if not exists restaurant_members_user_id_idx on public.restaurant_members (user_id);

alter table public.restaurant_members enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role = 'admin'
  );
$$;

create or replace function public.manages_restaurant(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.restaurant_members m
     where m.restaurant_id = p_restaurant_id
       and m.user_id = auth.uid()
  );
$$;

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
      select 1 from public.orders o
       where o.id = p_order_id
         and o.user_id = auth.uid()
    ) then 'customer'
    else null
  end;
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.manages_restaurant(uuid) from public;
revoke all on function public.order_actor_role(uuid) from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.manages_restaurant(uuid) to authenticated;
grant execute on function public.order_actor_role(uuid) to authenticated;

revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, phone, avatar_url) on public.profiles to authenticated;

revoke insert, update, delete on public.restaurant_members from anon, authenticated;
