create table if not exists public.delivery_assignments (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  courier_id uuid not null references public.couriers (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz
);

create index if not exists delivery_assignments_order_idx
  on public.delivery_assignments (order_id, assigned_at desc);
create unique index if not exists delivery_assignments_current_idx
  on public.delivery_assignments (delivery_id, courier_id)
  where unassigned_at is null;

create table if not exists public.order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  client_message_id uuid not null,
  sender_id uuid not null references auth.users (id) on delete cascade,
  sender_role text not null check (sender_role in ('customer', 'courier')),
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  unique (order_id, client_message_id)
);

create index if not exists order_messages_page_idx
  on public.order_messages (order_id, created_at desc, id desc);

create table if not exists public.order_message_reads (
  order_id uuid not null references public.orders (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (order_id, user_id)
);

alter table public.delivery_assignments enable row level security;
alter table public.order_messages enable row level security;
alter table public.order_message_reads enable row level security;

revoke all on public.delivery_assignments from anon, authenticated;
revoke all on public.order_messages from anon, authenticated;
revoke all on public.order_message_reads from anon, authenticated;
grant select on public.order_messages to authenticated;
grant select on public.order_message_reads to authenticated;

create or replace function public.is_terminal_order_status(p_status public.order_status)
returns boolean
language sql
immutable
as $$
  select p_status in (
    'delivered'::public.order_status,
    'payment_failed'::public.order_status,
    'restaurant_rejected'::public.order_status,
    'cancelled'::public.order_status,
    'refunded'::public.order_status
  );
$$;

create or replace function public.order_chat_courier_id(p_order_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select d.courier_id
    from public.deliveries d
   where d.order_id = p_order_id;
$$;

create or replace function public.order_chat_role(p_order_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then null
    when exists (
      select 1 from public.orders o
       where o.id = p_order_id and o.user_id = auth.uid()
    ) then 'customer'
    when exists (
      select 1 from public.deliveries d
       where d.order_id = p_order_id
         and d.courier_id is not null
         and d.courier_id = auth.uid()
    ) then 'courier'
    else null
  end;
$$;

create or replace function public.order_chat_can_send(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.order_chat_role(p_order_id) is not null
    and exists (
      select 1
        from public.orders o
        join public.deliveries d on d.order_id = o.id
       where o.id = p_order_id
         and d.courier_id is not null
         and not public.is_terminal_order_status(o.status)
    );
$$;

drop policy if exists "read own order messages" on public.order_messages;
create policy "read own order messages" on public.order_messages
  for select using (public.order_chat_role(order_id) is not null);

drop policy if exists "read own read position" on public.order_message_reads;
create policy "read own read position" on public.order_message_reads
  for select using (user_id = auth.uid());

create or replace function public.delivery_assignment_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.courier_id is not distinct from old.courier_id then
    return new;
  end if;

  update public.delivery_assignments
     set unassigned_at = now()
   where delivery_id = new.id
     and unassigned_at is null
     and courier_id is distinct from new.courier_id;

  if new.courier_id is not null then
    insert into public.delivery_assignments (delivery_id, order_id, courier_id)
    values (new.id, new.order_id, new.courier_id)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists delivery_assignment_sync on public.deliveries;
create trigger delivery_assignment_sync
  after insert or update of courier_id on public.deliveries
  for each row execute function public.delivery_assignment_sync();

insert into public.delivery_assignments (delivery_id, order_id, courier_id)
select d.id, d.order_id, d.courier_id
  from public.deliveries d
 where d.courier_id is not null
on conflict do nothing;

create or replace function public.order_chat_access(p_order_id uuid)
returns table (
  can_read boolean,
  can_send boolean,
  chat_role text,
  courier_assigned boolean,
  order_status text,
  counterpart_name text,
  reason text
)
language sql
stable
security definer
set search_path = public
as $$
  with context as (
    select
      o.id as order_id,
      o.status,
      public.order_chat_role(o.id) as chat_role,
      d.courier_id,
      c.full_name as courier_name,
      p.full_name as customer_name
    from public.orders o
    left join public.deliveries d on d.order_id = o.id
    left join public.couriers c on c.id = d.courier_id
    left join public.profiles p on p.id = o.user_id
   where o.id = p_order_id
  )
  select
    chat_role is not null as can_read,
    coalesce(
      chat_role is not null
        and courier_id is not null
        and not public.is_terminal_order_status(status),
      false
    ) as can_send,
    chat_role,
    courier_id is not null as courier_assigned,
    status::text as order_status,
    case
      when chat_role = 'customer' then courier_name
      when chat_role = 'courier' then customer_name
      else null
    end as counterpart_name,
    case
      when chat_role is null then 'no_access'
      when courier_id is null then 'no_courier_yet'
      when public.is_terminal_order_status(status) then 'order_closed'
      else 'open'
    end as reason
  from context;
$$;

create or replace function public.order_messages_page(
  p_order_id uuid,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit int default 30
)
returns table (
  id uuid,
  client_message_id uuid,
  sender_id uuid,
  sender_role text,
  body text,
  created_at timestamptz,
  is_mine boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.order_chat_role(p_order_id) is null then
    raise exception 'You cannot read this conversation' using errcode = '42501';
  end if;

  return query
  select m.id, m.client_message_id, m.sender_id, m.sender_role, m.body, m.created_at,
         m.sender_id = auth.uid() as is_mine
    from public.order_messages m
   where m.order_id = p_order_id
     and (
       p_before_created_at is null
       or (m.created_at, m.id) < (p_before_created_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid))
     )
   order by m.created_at desc, m.id desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

create or replace function public.send_order_message(
  p_order_id uuid,
  p_client_message_id uuid,
  p_body text
)
returns public.order_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_delivery public.deliveries;
  v_role text;
  v_message public.order_messages;
  v_body text := btrim(coalesce(p_body, ''));
  v_recipient uuid;
  v_audience text;
  v_sender_name text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in' using errcode = '28000';
  end if;

  if p_client_message_id is null then
    raise exception 'A message id is required' using errcode = '22023';
  end if;

  if v_body = '' then
    raise exception 'A message cannot be empty' using errcode = '22023';
  end if;

  if char_length(v_body) > 1000 then
    raise exception 'A message can be at most 1000 characters' using errcode = '22023';
  end if;

  select * into v_delivery from public.deliveries where order_id = p_order_id for update;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if v_delivery.id is null or v_delivery.courier_id is null then
    raise exception 'This order has no courier yet' using errcode = '42501';
  end if;

  if v_order.user_id = auth.uid() then
    v_role := 'customer';
    v_recipient := v_delivery.courier_id;
    v_audience := 'courier';
  elsif v_delivery.courier_id = auth.uid() then
    v_role := 'courier';
    v_recipient := v_order.user_id;
    v_audience := 'customer';
  else
    raise exception 'You cannot write in this conversation' using errcode = '42501';
  end if;

  select * into v_message
    from public.order_messages
   where order_id = p_order_id
     and client_message_id = p_client_message_id
     and sender_id = auth.uid();

  if v_message.id is not null then
    return v_message;
  end if;

  if public.is_terminal_order_status(v_order.status) then
    raise exception 'This order is closed' using errcode = '42501';
  end if;

  insert into public.order_messages (order_id, client_message_id, sender_id, sender_role, body)
  values (p_order_id, p_client_message_id, auth.uid(), v_role, v_body)
  on conflict (order_id, client_message_id) do nothing
  returning * into v_message;

  if v_message.id is null then
    select * into v_message
      from public.order_messages
     where order_id = p_order_id and client_message_id = p_client_message_id;
    return v_message;
  end if;

  select full_name into v_sender_name
    from public.profiles where id = auth.uid();

  if v_role = 'courier' then
    select full_name into v_sender_name from public.couriers where id = auth.uid();
  end if;

  insert into public.notifications (user_id, order_id, delivery_id, audience, kind, title, body, data)
  values (
    v_recipient,
    p_order_id,
    v_delivery.id,
    v_audience,
    'order_message',
    'New message',
    coalesce(nullif(v_sender_name, ''), case when v_role = 'courier' then 'Your courier' else 'The customer' end)
      || ' sent you a message',
    jsonb_build_object(
      'order_id', p_order_id,
      'message_id', v_message.id,
      'route', '/order/chat',
      'sender_role', v_role
    )
  )
  on conflict do nothing;

  return v_message;
end;
$$;

create unique index if not exists notifications_order_message_idx
  on public.notifications (user_id, kind, (data ->> 'message_id'))
  where kind = 'order_message';

create or replace function public.mark_order_messages_read(p_order_id uuid)
returns public.order_message_reads
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.order_message_reads;
begin
  if public.order_chat_role(p_order_id) is null then
    raise exception 'You cannot read this conversation' using errcode = '42501';
  end if;

  insert into public.order_message_reads (order_id, user_id, last_read_at, updated_at)
  values (p_order_id, auth.uid(), now(), now())
  on conflict (order_id, user_id) do update
     set last_read_at = now(), updated_at = now()
  returning * into v_row;

  update public.notifications
     set read_at = now()
   where user_id = auth.uid()
     and order_id = p_order_id
     and kind = 'order_message'
     and read_at is null;

  return v_row;
end;
$$;

create or replace function public.order_chat_unread_count(p_order_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.order_chat_role(p_order_id) is null then 0
    else (
      select count(*)::int
        from public.order_messages m
        left join public.order_message_reads r
          on r.order_id = m.order_id and r.user_id = auth.uid()
       where m.order_id = p_order_id
         and m.sender_id <> auth.uid()
         and (r.last_read_at is null or m.created_at > r.last_read_at)
    )
  end;
$$;

create or replace function public.order_chat_unread_totals()
returns table (order_id uuid, unread_count int)
language sql
stable
security definer
set search_path = public
as $$
  select m.order_id, count(*)::int as unread_count
    from public.order_messages m
    left join public.order_message_reads r
      on r.order_id = m.order_id and r.user_id = auth.uid()
   where m.sender_id <> auth.uid()
     and public.order_chat_role(m.order_id) is not null
     and (r.last_read_at is null or m.created_at > r.last_read_at)
   group by m.order_id;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'order_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.order_messages';
  end if;
end
$$;

revoke all on function public.order_chat_courier_id(uuid) from public, anon;
revoke all on function public.order_chat_role(uuid) from public, anon;
revoke all on function public.order_chat_can_send(uuid) from public, anon;
revoke all on function public.is_terminal_order_status(public.order_status) from public, anon;
revoke all on function public.order_chat_access(uuid) from public, anon;
revoke all on function public.order_messages_page(uuid, timestamptz, uuid, int) from public, anon;
revoke all on function public.send_order_message(uuid, uuid, text) from public, anon;
revoke all on function public.mark_order_messages_read(uuid) from public, anon;
revoke all on function public.order_chat_unread_count(uuid) from public, anon;
revoke all on function public.order_chat_unread_totals() from public, anon;
revoke all on function public.delivery_assignment_sync() from public, anon, authenticated;

grant execute on function public.order_chat_courier_id(uuid) to authenticated;
grant execute on function public.order_chat_role(uuid) to authenticated;
grant execute on function public.order_chat_can_send(uuid) to authenticated;
grant execute on function public.is_terminal_order_status(public.order_status) to authenticated;
grant execute on function public.order_chat_access(uuid) to authenticated;
grant execute on function public.order_messages_page(uuid, timestamptz, uuid, int) to authenticated;
grant execute on function public.send_order_message(uuid, uuid, text) to authenticated;
grant execute on function public.mark_order_messages_read(uuid) to authenticated;
grant execute on function public.order_chat_unread_count(uuid) to authenticated;
grant execute on function public.order_chat_unread_totals() to authenticated;

create or replace function public.notification_recipient_still_authorised(
  p_kind text,
  p_user_id uuid,
  p_order_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_kind <> 'order_message' then true
    when p_order_id is null then false
    else exists (
      select 1 from public.orders o where o.id = p_order_id and o.user_id = p_user_id
    ) or exists (
      select 1 from public.deliveries d
       where d.order_id = p_order_id and d.courier_id = p_user_id
    )
  end;
$$;

create or replace function public.claim_notifications_for_push(p_limit int default 100)
returns table (
  notification_id uuid,
  user_id uuid,
  token text,
  platform text,
  title text,
  body text,
  data jsonb
)
language sql
security definer
set search_path = public
as $$
  with claimed as (
    select n.id
      from public.notifications n
     where n.pushed_at is null
       and n.created_at > now() - interval '1 day'
     order by n.created_at
     limit greatest(coalesce(p_limit, 100), 1)
     for update skip locked
  ),
  stamped as (
    update public.notifications n
       set pushed_at = now()
      from claimed c
     where n.id = c.id
    returning n.id, n.user_id, n.title, n.body, n.data, n.order_id, n.delivery_id, n.kind
  )
  select s.id,
         s.user_id,
         t.token,
         t.platform,
         s.title,
         s.body,
         s.data
           || jsonb_build_object('notification_id', s.id, 'kind', s.kind)
           || case when s.order_id is null then '{}'::jsonb
                   else jsonb_build_object('order_id', s.order_id) end
           || case when s.delivery_id is null then '{}'::jsonb
                   else jsonb_build_object('delivery_id', s.delivery_id) end
    from stamped s
    join public.push_tokens t on t.user_id = s.user_id
   where public.notification_recipient_still_authorised(s.kind, s.user_id, s.order_id);
$$;

revoke all on function public.notification_recipient_still_authorised(text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.claim_notifications_for_push(int) from public, anon, authenticated;
grant execute on function public.claim_notifications_for_push(int) to service_role;
