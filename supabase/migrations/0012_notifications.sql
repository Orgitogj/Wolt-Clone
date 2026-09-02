create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  order_id uuid references public.orders (id) on delete cascade,
  delivery_id uuid references public.deliveries (id) on delete set null,
  audience text not null check (audience in ('customer', 'restaurant', 'courier')),
  kind text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  pushed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;
create index if not exists notifications_unpushed_idx
  on public.notifications (created_at) where pushed_at is null;

alter table public.notifications enable row level security;

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create table if not exists public.notification_templates (
  to_status public.order_status not null,
  audience text not null check (audience in ('customer', 'restaurant', 'courier')),
  title text not null,
  body text not null,
  primary key (to_status, audience)
);

alter table public.notification_templates enable row level security;

insert into public.notification_templates (to_status, audience, title, body) values
  ('placed',              'restaurant', 'New order',            'Order {order} needs your confirmation.'),
  ('placed',              'customer',   'Order placed',         'We sent your order to {restaurant}.'),
  ('accepted',            'customer',   'Order accepted',       '{restaurant} accepted your order.'),
  ('preparing',           'customer',   'Being prepared',       '{restaurant} started preparing your food.'),
  ('ready_for_pickup',    'customer',   'Ready',                'Your order at {restaurant} is ready.'),
  ('courier_assigned',    'customer',   'Courier on the way',   'A courier is heading to {restaurant}.'),
  ('courier_assigned',    'restaurant', 'Courier assigned',     'A courier is coming for order {order}.'),
  ('picked_up',           'customer',   'Picked up',            'Your order has left {restaurant}.'),
  ('picked_up',           'restaurant', 'Order collected',      'The courier collected order {order}.'),
  ('delivering',          'customer',   'On the way',           'Your order is on the way to you.'),
  ('delivered',           'customer',   'Delivered',            'Enjoy your order from {restaurant}.'),
  ('delivered',           'restaurant', 'Order delivered',      'Order {order} was delivered.'),
  ('restaurant_rejected', 'customer',   'Order rejected',       '{restaurant} could not take your order.'),
  ('cancelled',           'customer',   'Order cancelled',      'Your order at {restaurant} was cancelled.'),
  ('cancelled',           'restaurant', 'Order cancelled',      'Order {order} was cancelled.'),
  ('cancelled',           'courier',    'Delivery cancelled',   'Order {order} was cancelled.'),
  ('refunded',            'customer',   'Refunded',             'Your order at {restaurant} was refunded.'),
  ('payment_failed',      'customer',   'Payment failed',       'We could not take payment for your order.')
on conflict (to_status, audience) do nothing;

create or replace function public.notify_order_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_restaurant_name text;
  v_short_order text;
  v_delivery_id uuid;
  v_template public.notification_templates;
  v_recipient uuid;
begin
  select * into v_order from public.orders where id = new.order_id;
  if not found then
    return new;
  end if;

  select name into v_restaurant_name from public.restaurants where id = v_order.restaurant_id;
  v_short_order := '#' || substr(new.order_id::text, 1, 8);

  select id into v_delivery_id from public.deliveries where order_id = new.order_id;

  for v_template in
    select * from public.notification_templates where to_status = new.to_status
  loop
    if v_template.audience = 'customer' then
      insert into public.notifications (
        user_id, order_id, delivery_id, audience, kind, title, body, data
      )
      values (
        v_order.user_id, new.order_id, v_delivery_id, 'customer', new.to_status::text,
        v_template.title,
        replace(replace(v_template.body, '{restaurant}', coalesce(v_restaurant_name, 'the restaurant')),
                '{order}', v_short_order),
        jsonb_build_object('order_id', new.order_id, 'status', new.to_status)
      );

    elsif v_template.audience = 'restaurant' then
      for v_recipient in
        select user_id from public.restaurant_members where restaurant_id = v_order.restaurant_id
      loop
        insert into public.notifications (
          user_id, order_id, delivery_id, audience, kind, title, body, data
        )
        values (
          v_recipient, new.order_id, v_delivery_id, 'restaurant', new.to_status::text,
          v_template.title,
          replace(replace(v_template.body, '{restaurant}', coalesce(v_restaurant_name, 'the restaurant')),
                  '{order}', v_short_order),
          jsonb_build_object('order_id', new.order_id, 'status', new.to_status)
        );
      end loop;

    elsif v_template.audience = 'courier' then
      select courier_id into v_recipient
        from public.deliveries
       where order_id = new.order_id and courier_id is not null;

      if v_recipient is not null then
        insert into public.notifications (
          user_id, order_id, delivery_id, audience, kind, title, body, data
        )
        values (
          v_recipient, new.order_id, v_delivery_id, 'courier', new.to_status::text,
          v_template.title,
          replace(replace(v_template.body, '{restaurant}', coalesce(v_restaurant_name, 'the restaurant')),
                  '{order}', v_short_order),
          jsonb_build_object('order_id', new.order_id, 'status', new.to_status)
        );
      end if;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists order_status_history_notify on public.order_status_history;
create trigger order_status_history_notify
  after insert on public.order_status_history
  for each row execute function public.notify_order_event();

create or replace function public.register_push_token(
  p_token text,
  p_platform text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in' using errcode = '28000';
  end if;

  if p_platform not in ('ios', 'android', 'web') then
    raise exception 'Invalid platform: %', p_platform using errcode = '22023';
  end if;

  if btrim(coalesce(p_token, '')) = '' then
    raise exception 'A push token is required' using errcode = '22023';
  end if;

  insert into public.push_tokens (user_id, token, platform)
  values (auth.uid(), btrim(p_token), p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        last_seen_at = now();
end;
$$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in' using errcode = '28000';
  end if;

  update public.notifications
     set read_at = now()
   where user_id = auth.uid()
     and read_at is null
     and (p_ids is null or id = any (p_ids));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists "read own push tokens" on public.push_tokens;
create policy "read own push tokens" on public.push_tokens
  for select using (user_id = auth.uid());

drop policy if exists "read notification templates" on public.notification_templates;
create policy "read notification templates" on public.notification_templates
  for select using (true);

revoke all on function public.register_push_token(text, text) from public, anon;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

revoke insert, update, delete on public.notifications from anon, authenticated;
revoke insert, update, delete on public.push_tokens from anon, authenticated;
revoke insert, update, delete on public.notification_templates from anon, authenticated;
