do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type public.order_status as enum (
      'pending_payment',
      'placed',
      'accepted',
      'preparing',
      'ready_for_pickup',
      'courier_assigned',
      'picked_up',
      'delivering',
      'delivered',
      'payment_failed',
      'restaurant_rejected',
      'cancelled',
      'refunded'
    );
  end if;
end
$$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders'
       and column_name = 'status' and data_type = 'text'
  ) then
    alter table public.orders drop constraint if exists orders_status_check;

    update public.orders
       set status = case status
                      when 'confirmed' then 'accepted'
                      when 'on_the_way' then 'delivering'
                      else status
                    end;

    alter table public.orders alter column status drop default;
    alter table public.orders
      alter column status type public.order_status using status::public.order_status;
    alter table public.orders alter column status set default 'placed';
  end if;
end
$$;

alter table public.orders add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create table if not exists public.order_status_transitions (
  from_status public.order_status not null,
  to_status public.order_status not null,
  actor_role text not null check (actor_role in ('customer', 'restaurant', 'courier', 'admin', 'system')),
  primary key (from_status, to_status, actor_role)
);

alter table public.order_status_transitions enable row level security;

insert into public.order_status_transitions (from_status, to_status, actor_role) values
  ('pending_payment', 'placed',              'system'),
  ('pending_payment', 'payment_failed',      'system'),
  ('pending_payment', 'cancelled',           'customer'),
  ('pending_payment', 'cancelled',           'admin'),

  ('placed',           'accepted',            'restaurant'),
  ('placed',           'accepted',            'admin'),
  ('placed',           'restaurant_rejected', 'restaurant'),
  ('placed',           'restaurant_rejected', 'admin'),
  ('placed',           'cancelled',           'customer'),
  ('placed',           'cancelled',           'admin'),

  ('accepted',         'preparing',           'restaurant'),
  ('accepted',         'preparing',           'admin'),
  ('accepted',         'cancelled',           'restaurant'),
  ('accepted',         'cancelled',           'admin'),
  ('preparing',        'ready_for_pickup',    'restaurant'),
  ('preparing',        'ready_for_pickup',    'admin'),
  ('preparing',        'cancelled',           'restaurant'),
  ('preparing',        'cancelled',           'admin'),

  ('ready_for_pickup', 'delivered',           'restaurant'),
  ('ready_for_pickup', 'delivered',           'admin'),
  ('ready_for_pickup', 'courier_assigned',    'system'),
  ('ready_for_pickup', 'courier_assigned',    'admin'),
  ('ready_for_pickup', 'cancelled',           'admin'),

  ('courier_assigned', 'picked_up',           'courier'),
  ('courier_assigned', 'picked_up',           'admin'),
  ('courier_assigned', 'cancelled',           'admin'),
  ('picked_up',        'delivering',          'courier'),
  ('picked_up',        'delivering',          'admin'),
  ('picked_up',        'cancelled',           'admin'),
  ('delivering',       'delivered',           'courier'),
  ('delivering',       'delivered',           'admin'),
  ('delivering',       'cancelled',           'admin'),

  ('delivered',           'refunded',         'admin'),
  ('cancelled',           'refunded',         'admin'),
  ('restaurant_rejected', 'refunded',         'admin')
on conflict do nothing;

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  actor_id uuid references auth.users (id) on delete set null,
  actor_role text not null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists order_status_history_order_id_idx
  on public.order_status_history (order_id, created_at desc);

alter table public.order_status_history enable row level security;

create or replace function public.transition_order_status(
  p_order_id uuid,
  p_to public.order_status,
  p_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_from public.order_status;
  v_actor_role text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = '42501';
  end if;

  v_actor_role := public.order_actor_role(p_order_id);
  if v_actor_role is null then
    raise exception 'Order not found' using errcode = '42501';
  end if;

  v_from := v_order.status;

  if v_from = p_to then
    return v_order;
  end if;

  if not exists (
    select 1 from public.order_status_transitions t
     where t.from_status = v_from
       and t.to_status = p_to
       and t.actor_role = v_actor_role
  ) then
    raise exception 'A % cannot move an order from % to %', v_actor_role, v_from, p_to
      using errcode = '42501';
  end if;

  update public.orders
     set status = p_to
   where id = p_order_id
   returning * into v_order;

  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_role, reason)
  values (p_order_id, v_from, p_to, auth.uid(), v_actor_role, nullif(btrim(coalesce(p_reason, '')), ''));

  return v_order;
end;
$$;

revoke all on function public.transition_order_status(uuid, public.order_status, text) from public, anon;
grant execute on function public.transition_order_status(uuid, public.order_status, text) to authenticated;

revoke insert, update, delete on public.orders from anon, authenticated;
revoke insert, update, delete on public.order_items from anon, authenticated;
revoke insert, update, delete on public.order_status_history from anon, authenticated;
revoke insert, update, delete on public.order_status_transitions from anon, authenticated;
