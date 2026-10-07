do $$
begin
  if not exists (select 1 from pg_type where typname = 'support_ticket_status') then
    create type public.support_ticket_status as enum ('open', 'in_review', 'resolved');
  end if;
  if not exists (select 1 from pg_type where typname = 'support_category') then
    create type public.support_category as enum (
      'missing_items', 'incorrect_items', 'late_delivery', 'not_delivered', 'other'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'support_refund_state') then
    create type public.support_refund_state as enum (
      'reserved', 'confirmed', 'failed', 'cancelled'
    );
  end if;
end
$$;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  client_ticket_id uuid not null,
  category public.support_category not null,
  description text not null check (char_length(btrim(description)) between 1 and 2000),
  status public.support_ticket_status not null default 'open',
  assigned_admin_id uuid references auth.users (id) on delete set null,
  reopened_count int not null default 0,
  revision int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (user_id, client_ticket_id)
);

create index if not exists support_tickets_user_idx
  on public.support_tickets (user_id, created_at desc);
create index if not exists support_tickets_order_idx on public.support_tickets (order_id);
create index if not exists support_tickets_queue_idx
  on public.support_tickets (status, created_at desc);
create index if not exists support_tickets_assigned_idx
  on public.support_tickets (assigned_admin_id, status);

create table if not exists public.support_ticket_items (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  quantity int not null check (quantity > 0),
  unique (ticket_id, order_item_id)
);

create index if not exists support_ticket_items_ticket_idx
  on public.support_ticket_items (ticket_id);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  client_message_id uuid not null,
  sender_id uuid not null references auth.users (id) on delete cascade,
  sender_role text not null check (sender_role in ('customer', 'admin')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique (ticket_id, client_message_id)
);

create index if not exists support_messages_page_idx
  on public.support_messages (ticket_id, created_at desc, id desc);

create table if not exists public.support_refunds (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  payment_id uuid references public.payments (id) on delete set null,
  client_request_id uuid,
  method text not null check (method in ('card', 'cash')),
  liability text not null default 'platform' check (liability in ('platform', 'restaurant')),
  amount numeric(10,2) not null check (amount > 0),
  currency text not null default 'EUR',
  reason text not null,
  state public.support_refund_state not null default 'reserved',
  reconciliation_id uuid references public.payment_reconciliations (id) on delete set null,
  provider_idempotency_key uuid not null default gen_random_uuid(),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz not null default now(),
  settled_by uuid references auth.users (id) on delete set null,
  settled_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_refunds_order_idx on public.support_refunds (order_id, state);
create index if not exists support_refunds_ticket_idx on public.support_refunds (ticket_id);
create unique index if not exists support_refunds_reconciliation_idx
  on public.support_refunds (reconciliation_id) where reconciliation_id is not null;
create unique index if not exists support_refunds_request_idx
  on public.support_refunds (ticket_id, client_request_id) where client_request_id is not null;

drop index if exists public.payment_reconciliations_open_idx;
create unique index if not exists payment_reconciliations_unfulfilled_idx
  on public.payment_reconciliations (payment_id, kind)
  where kind = 'refund_unfulfilled_order' and state <> 'resolved';

alter table public.payment_reconciliations drop constraint if exists payment_reconciliations_kind_check;
alter table public.payment_reconciliations
  add constraint payment_reconciliations_kind_check
  check (kind in ('refund_unfulfilled_order', 'support_refund'));

alter table public.support_tickets enable row level security;
alter table public.support_ticket_items enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_refunds enable row level security;

revoke all on public.support_tickets from anon, authenticated;
revoke all on public.support_ticket_items from anon, authenticated;
revoke all on public.support_messages from anon, authenticated;
revoke all on public.support_refunds from anon, authenticated;
grant select on public.support_tickets to authenticated;
grant select on public.support_ticket_items to authenticated;
grant select on public.support_messages to authenticated;
grant select on public.support_refunds to authenticated;

create or replace function public.support_ticket_role(p_ticket_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then null
    when public.is_admin() then 'admin'
    when exists (
      select 1 from public.support_tickets t
       where t.id = p_ticket_id and t.user_id = auth.uid()
    ) then 'customer'
    else null
  end;
$$;

drop policy if exists "read own support tickets" on public.support_tickets;
create policy "read own support tickets" on public.support_tickets
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "read own support ticket items" on public.support_ticket_items;
create policy "read own support ticket items" on public.support_ticket_items
  for select using (public.support_ticket_role(ticket_id) is not null);

drop policy if exists "read own support messages" on public.support_messages;
create policy "read own support messages" on public.support_messages
  for select using (public.support_ticket_role(ticket_id) is not null);

drop policy if exists "read own support refunds" on public.support_refunds;
create policy "read own support refunds" on public.support_refunds
  for select using (
    public.is_admin()
    or exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  );

create or replace function public.support_report_window_days()
returns int language sql immutable as $$ select 7; $$;

create or replace function public.support_max_tickets_per_order()
returns int language sql immutable as $$ select 5; $$;

create or replace function public.support_max_reopens()
returns int language sql immutable as $$ select 3; $$;

create or replace function public.support_report_eligibility(p_order_id uuid)
returns table (
  can_report boolean,
  reason text,
  open_ticket_id uuid,
  closes_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with context as (
    select
      o.id,
      o.status,
      o.user_id,
      coalesce(
        (select max(h.created_at) from public.order_status_history h
          where h.order_id = o.id and public.is_terminal_order_status(h.to_status)),
        o.created_at
      ) as closed_at,
      (select t.id from public.support_tickets t
        where t.order_id = o.id and t.status <> 'resolved'
        order by t.created_at desc limit 1) as open_ticket,
      (select count(*) from public.support_tickets t where t.order_id = o.id) as ticket_count
    from public.orders o
   where o.id = p_order_id
  )
  select
    case
      when id is null then false
      when user_id is distinct from auth.uid() then false
      when status = 'pending_payment' then false
      when open_ticket is not null then false
      when ticket_count >= public.support_max_tickets_per_order() then false
      when public.is_terminal_order_status(status)
           and closed_at + make_interval(days => public.support_report_window_days()) < now()
        then false
      else true
    end as can_report,
    case
      when id is null then 'not_found'
      when user_id is distinct from auth.uid() then 'not_your_order'
      when status = 'pending_payment' then 'not_started'
      when open_ticket is not null then 'already_open'
      when ticket_count >= public.support_max_tickets_per_order() then 'too_many_tickets'
      when public.is_terminal_order_status(status)
           and closed_at + make_interval(days => public.support_report_window_days()) < now()
        then 'window_closed'
      else 'eligible'
    end as reason,
    open_ticket as open_ticket_id,
    case
      when public.is_terminal_order_status(status)
        then closed_at + make_interval(days => public.support_report_window_days())
      else null
    end as closes_at
  from context;
$$;

create or replace function public.submit_support_ticket(
  p_order_id uuid,
  p_client_ticket_id uuid,
  p_category text,
  p_description text,
  p_items jsonb default '[]'::jsonb
)
returns public.support_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_ticket public.support_tickets;
  v_description text := btrim(coalesce(p_description, ''));
  v_item jsonb;
  v_order_item public.order_items;
  v_quantity int;
  v_eligible boolean;
  v_reason text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in' using errcode = '28000';
  end if;

  if p_client_ticket_id is null then
    raise exception 'A report id is required' using errcode = '22023';
  end if;

  select * into v_ticket
    from public.support_tickets
   where user_id = auth.uid() and client_ticket_id = p_client_ticket_id;
  if found then
    return v_ticket;
  end if;

  if v_description = '' then
    raise exception 'Please describe the problem' using errcode = '22023';
  end if;

  if char_length(v_description) > 2000 then
    raise exception 'The description is too long' using errcode = '22023';
  end if;

  if p_category not in ('missing_items', 'incorrect_items', 'late_delivery', 'not_delivered', 'other') then
    raise exception 'Unknown problem category' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  select can_report, reason into v_eligible, v_reason
    from public.support_report_eligibility(p_order_id);

  if not v_eligible then
    raise exception 'This order cannot be reported right now (%)', v_reason using errcode = '42501';
  end if;

  insert into public.support_tickets (
    order_id, user_id, client_ticket_id, category, description
  )
  values (
    p_order_id, auth.uid(), p_client_ticket_id,
    p_category::public.support_category, v_description
  )
  returning * into v_ticket;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_quantity := coalesce((v_item ->> 'quantity')::int, 0);

    select * into v_order_item
      from public.order_items
     where id = (v_item ->> 'order_item_id')::uuid
       and order_id = p_order_id;

    if not found then
      raise exception 'That item does not belong to this order' using errcode = '42501';
    end if;

    if v_quantity <= 0 or v_quantity > v_order_item.quantity then
      raise exception 'Invalid quantity for %', v_order_item.dish_name using errcode = '22023';
    end if;

    insert into public.support_ticket_items (ticket_id, order_item_id, quantity)
    values (v_ticket.id, v_order_item.id, v_quantity)
    on conflict (ticket_id, order_item_id) do update set quantity = excluded.quantity;
  end loop;

  insert into public.support_messages (ticket_id, client_message_id, sender_id, sender_role, body)
  values (v_ticket.id, p_client_ticket_id, auth.uid(), 'customer', v_description);

  return v_ticket;
end;
$$;

create or replace function public.support_messages_page(
  p_ticket_id uuid,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit int default 30
)
returns table (
  id uuid,
  client_message_id uuid,
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
  if public.support_ticket_role(p_ticket_id) is null then
    raise exception 'You cannot read this conversation' using errcode = '42501';
  end if;

  return query
  select m.id, m.client_message_id, m.sender_role, m.body, m.created_at,
         m.sender_id = auth.uid() as is_mine
    from public.support_messages m
   where m.ticket_id = p_ticket_id
     and (
       p_before_created_at is null
       or (m.created_at, m.id) < (p_before_created_at, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid))
     )
   order by m.created_at desc, m.id desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

create or replace function public.send_support_message(
  p_ticket_id uuid,
  p_client_message_id uuid,
  p_body text
)
returns public.support_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.support_tickets;
  v_role text;
  v_message public.support_messages;
  v_body text := btrim(coalesce(p_body, ''));
  v_recipient uuid;
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

  if char_length(v_body) > 2000 then
    raise exception 'A message can be at most 2000 characters' using errcode = '22023';
  end if;

  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;

  v_role := public.support_ticket_role(p_ticket_id);
  if v_role is null then
    raise exception 'You cannot write in this conversation' using errcode = '42501';
  end if;

  select * into v_message
    from public.support_messages
   where ticket_id = p_ticket_id
     and client_message_id = p_client_message_id
     and sender_id = auth.uid();
  if found then
    return v_message;
  end if;

  if v_role = 'customer'
     and v_ticket.status = 'resolved'
     and v_ticket.reopened_count >= public.support_max_reopens() then
    raise exception 'This ticket cannot be reopened again' using errcode = '42501';
  end if;

  insert into public.support_messages (ticket_id, client_message_id, sender_id, sender_role, body)
  values (p_ticket_id, p_client_message_id, auth.uid(), v_role, v_body)
  returning * into v_message;

  if v_role = 'customer' and v_ticket.status = 'resolved' then
    update public.support_tickets
       set status = 'open',
           reopened_count = reopened_count + 1,
           resolved_at = null,
           revision = revision + 1,
           updated_at = now()
     where id = p_ticket_id;
  else
    update public.support_tickets set updated_at = now() where id = p_ticket_id;
  end if;

  if v_role = 'admin' then
    v_recipient := v_ticket.user_id;

    insert into public.notifications (user_id, order_id, audience, kind, title, body, data)
    values (
      v_recipient,
      v_ticket.order_id,
      'customer',
      'support_message',
      'Support replied',
      'Our support team replied to your report',
      jsonb_build_object(
        'ticket_id', p_ticket_id,
        'order_id', v_ticket.order_id,
        'message_id', v_message.id,
        'route', '/order/support-ticket'
      )
    )
    on conflict do nothing;
  end if;

  return v_message;
end;
$$;

create unique index if not exists notifications_support_message_idx
  on public.notifications (user_id, kind, (data ->> 'message_id'))
  where kind = 'support_message';

create unique index if not exists notifications_support_status_idx
  on public.notifications (user_id, kind, (data ->> 'ticket_id'), (data ->> 'status'))
  where kind = 'support_status';

create unique index if not exists notifications_support_refund_idx
  on public.notifications (user_id, kind, (data ->> 'refund_id'), (data ->> 'state'))
  where kind = 'support_refund';

create or replace function public.my_support_tickets(
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  order_id uuid,
  restaurant_name text,
  category public.support_category,
  status public.support_ticket_status,
  description text,
  created_at timestamptz,
  updated_at timestamptz,
  unread_count int,
  refunded_amount numeric,
  pending_refund numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.order_id,
    r.name as restaurant_name,
    t.category,
    t.status,
    t.description,
    t.created_at,
    t.updated_at,
    (
      select count(*)::int from public.support_messages m
       where m.ticket_id = t.id and m.sender_role = 'admin'
         and m.created_at > coalesce(t.resolved_at, t.created_at - interval '100 years')
    ) as unread_count,
    coalesce((
      select sum(sr.amount) from public.support_refunds sr
       where sr.ticket_id = t.id and sr.state = 'confirmed'
    ), 0) as refunded_amount,
    coalesce((
      select sum(sr.amount) from public.support_refunds sr
       where sr.ticket_id = t.id and sr.state = 'reserved'
    ), 0) as pending_refund
  from public.support_tickets t
  join public.orders o on o.id = t.order_id
  join public.restaurants r on r.id = o.restaurant_id
 where t.user_id = auth.uid()
 order by t.updated_at desc, t.id
 limit public.search_page_size(p_limit)
offset public.search_page_offset(p_offset);
$$;

create or replace function public.support_ticket_details(p_ticket_id uuid)
returns table (
  id uuid,
  order_id uuid,
  user_id uuid,
  restaurant_name text,
  category public.support_category,
  status public.support_ticket_status,
  description text,
  assigned_admin_id uuid,
  assigned_admin_name text,
  revision int,
  reopened_count int,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz,
  order_total numeric,
  payment_method text,
  viewer_role text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.support_ticket_role(p_ticket_id) is null then
    raise exception 'You cannot read this ticket' using errcode = '42501';
  end if;

  return query
  select
    t.id, t.order_id, t.user_id, r.name, t.category, t.status, t.description,
    t.assigned_admin_id, p.full_name, t.revision, t.reopened_count,
    t.created_at, t.updated_at, t.resolved_at,
    o.total, o.payment_method,
    public.support_ticket_role(p_ticket_id)
  from public.support_tickets t
  join public.orders o on o.id = t.order_id
  join public.restaurants r on r.id = o.restaurant_id
  left join public.profiles p on p.id = t.assigned_admin_id
 where t.id = p_ticket_id;
end;
$$;

create or replace function public.support_ticket_reported_items(p_ticket_id uuid)
returns table (
  order_item_id uuid,
  dish_name text,
  reported_quantity int,
  ordered_quantity int,
  unit_price numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.support_ticket_role(p_ticket_id) is null then
    raise exception 'You cannot read this ticket' using errcode = '42501';
  end if;

  return query
  select oi.id, oi.dish_name, si.quantity, oi.quantity, oi.unit_price
    from public.support_ticket_items si
    join public.order_items oi on oi.id = si.order_item_id
   where si.ticket_id = p_ticket_id
   order by oi.dish_name;
end;
$$;

create or replace function public.order_refund_summary(p_order_id uuid)
returns table (
  charged numeric,
  confirmed_refunds numeric,
  reserved_refunds numeric,
  remaining_refundable numeric,
  currency text,
  method text
)
language sql
stable
security definer
set search_path = public
as $$
  with context as (
    select
      o.id,
      o.total,
      o.payment_method,
      p.id as payment_id,
      p.amount as paid_amount,
      p.amount_refunded,
      coalesce(p.currency, 'EUR') as currency
    from public.orders o
    left join public.payments p on p.order_id = o.id
   where o.id = p_order_id
     and (
       public.is_admin()
       or o.user_id = auth.uid()
     )
  ),
  reserved as (
    select coalesce(sum(sr.amount), 0) as amount
      from public.support_refunds sr, context c
     where sr.order_id = c.id and sr.state = 'reserved'
  ),
  queued as (
    select coalesce(sum(pr.amount), 0) as amount
      from public.payment_reconciliations pr, context c
     where pr.payment_id = c.payment_id
       and pr.kind = 'refund_unfulfilled_order'
       and pr.state <> 'resolved'
  ),
  cash_confirmed as (
    select coalesce(sum(sr.amount), 0) as amount
      from public.support_refunds sr, context c
     where sr.order_id = c.id and sr.state = 'confirmed' and sr.method = 'cash'
  )
  select
    case when c.payment_id is null then c.total else c.paid_amount end as charged,
    case when c.payment_id is null then cc.amount else c.amount_refunded end as confirmed_refunds,
    r.amount + q.amount as reserved_refunds,
    greatest(
      0,
      round(
        (case when c.payment_id is null then c.total else c.paid_amount end)
        - (case when c.payment_id is null then cc.amount else c.amount_refunded end)
        - r.amount - q.amount,
        2
      )
    ) as remaining_refundable,
    c.currency,
    case when c.payment_id is null then 'cash' else 'card' end as method
  from context c, reserved r, queued q, cash_confirmed cc;
$$;

create or replace function public.admin_support_tickets(
  p_status text default null,
  p_category text default null,
  p_assignment text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  order_id uuid,
  user_id uuid,
  customer_name text,
  restaurant_name text,
  category public.support_category,
  status public.support_ticket_status,
  description text,
  assigned_admin_id uuid,
  assigned_admin_name text,
  revision int,
  created_at timestamptz,
  updated_at timestamptz,
  order_total numeric,
  payment_method text,
  refunded_amount numeric,
  reserved_amount numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id, t.order_id, t.user_id, cp.full_name, r.name, t.category, t.status, t.description,
    t.assigned_admin_id, ap.full_name, t.revision, t.created_at, t.updated_at,
    o.total, o.payment_method,
    coalesce((select sum(sr.amount) from public.support_refunds sr
               where sr.ticket_id = t.id and sr.state = 'confirmed'), 0),
    coalesce((select sum(sr.amount) from public.support_refunds sr
               where sr.ticket_id = t.id and sr.state = 'reserved'), 0)
  from public.support_tickets t
  join public.orders o on o.id = t.order_id
  join public.restaurants r on r.id = o.restaurant_id
  left join public.profiles cp on cp.id = t.user_id
  left join public.profiles ap on ap.id = t.assigned_admin_id
 where public.is_admin()
   and (p_status is null or t.status = p_status::public.support_ticket_status)
   and (p_category is null or t.category = p_category::public.support_category)
   and (
     p_assignment is null
     or (p_assignment = 'unassigned' and t.assigned_admin_id is null)
     or (p_assignment = 'mine' and t.assigned_admin_id = auth.uid())
   )
 order by
   case t.status when 'open' then 0 when 'in_review' then 1 else 2 end,
   t.updated_at desc
 limit public.search_page_size(p_limit)
offset public.search_page_offset(p_offset);
$$;

create or replace function public.admin_assign_support_ticket(
  p_ticket_id uuid,
  p_admin_id uuid,
  p_expected_revision int
)
returns public.support_tickets
language plpgsql
security definer
set search_path = public
as $$
declare v_ticket public.support_tickets;
begin
  perform public.require_admin();

  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;

  if p_expected_revision is not null and v_ticket.revision <> p_expected_revision then
    raise exception 'This ticket changed while you were looking at it' using errcode = '40001';
  end if;

  if p_admin_id is not null and not exists (
    select 1 from public.profiles where id = p_admin_id and role = 'admin'
  ) then
    raise exception 'Tickets can only be assigned to an administrator' using errcode = '42501';
  end if;

  update public.support_tickets
     set assigned_admin_id = p_admin_id,
         status = case when p_admin_id is not null and status = 'open' then 'in_review' else status end,
         revision = revision + 1,
         updated_at = now()
   where id = p_ticket_id
  returning * into v_ticket;

  insert into public.admin_actions (admin_id, action, subject_type, subject_id, details)
  values (
    auth.uid(),
    case when p_admin_id is null then 'unassign_support_ticket' else 'assign_support_ticket' end,
    'support_ticket',
    p_ticket_id::text,
    jsonb_build_object('assigned_admin_id', p_admin_id, 'revision', v_ticket.revision)
  );

  return v_ticket;
end;
$$;

create or replace function public.admin_set_support_status(
  p_ticket_id uuid,
  p_status text,
  p_expected_revision int,
  p_note text default null
)
returns public.support_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.support_tickets;
  v_pending int;
begin
  perform public.require_admin();

  if p_status not in ('open', 'in_review', 'resolved') then
    raise exception 'Unknown ticket status' using errcode = '22023';
  end if;

  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;

  if p_expected_revision is not null and v_ticket.revision <> p_expected_revision then
    raise exception 'This ticket changed while you were looking at it' using errcode = '40001';
  end if;

  if p_status = 'resolved' then
    select count(*) into v_pending
      from public.support_refunds
     where ticket_id = p_ticket_id and state = 'reserved';

    if v_pending > 0 then
      raise exception 'A refund on this ticket has not settled yet' using errcode = '42501';
    end if;
  end if;

  update public.support_tickets
     set status = p_status::public.support_ticket_status,
         resolved_at = case when p_status = 'resolved' then now() else null end,
         revision = revision + 1,
         updated_at = now()
   where id = p_ticket_id
  returning * into v_ticket;

  insert into public.admin_actions (admin_id, action, subject_type, subject_id, details)
  values (
    auth.uid(), 'set_support_status', 'support_ticket', p_ticket_id::text,
    jsonb_build_object('status', p_status, 'note', nullif(btrim(coalesce(p_note, '')), ''))
  );

  insert into public.notifications (user_id, order_id, audience, kind, title, body, data)
  values (
    v_ticket.user_id, v_ticket.order_id, 'customer', 'support_status',
    'Support update',
    case p_status
      when 'resolved' then 'Your report has been resolved'
      when 'in_review' then 'Our team is looking into your report'
      else 'Your report was reopened'
    end,
    jsonb_build_object(
      'ticket_id', p_ticket_id, 'order_id', v_ticket.order_id,
      'status', p_status, 'route', '/order/support-ticket'
    )
  )
  on conflict do nothing;

  return v_ticket;
end;
$$;

create or replace function public.admin_approve_support_refund(
  p_ticket_id uuid,
  p_amount numeric,
  p_reason text,
  p_liability text default 'platform',
  p_client_request_id uuid default null
)
returns public.support_refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.support_tickets;
  v_order public.orders;
  v_payment public.payments;
  v_refund public.support_refunds;
  v_reconciliation public.payment_reconciliations;
  v_remaining numeric(10,2);
  v_amount numeric(10,2) := round(coalesce(p_amount, 0), 2);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_method text;
begin
  perform public.require_admin();

  if v_reason is null then
    raise exception 'A reason is required to approve a refund' using errcode = '22023';
  end if;

  if p_liability not in ('platform', 'restaurant') then
    raise exception 'Unknown refund liability' using errcode = '22023';
  end if;

  if v_amount <= 0 then
    raise exception 'A refund must be greater than zero' using errcode = '22023';
  end if;

  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;

  if p_client_request_id is not null then
    select * into v_refund
      from public.support_refunds
     where ticket_id = p_ticket_id and client_request_id = p_client_request_id;

    if v_refund.id is not null then
      return v_refund;
    end if;
  end if;

  select * into v_order from public.orders where id = v_ticket.order_id for update;
  select * into v_payment from public.payments where order_id = v_ticket.order_id for update;

  v_method := case when v_payment.id is null then 'cash' else 'card' end;

  select remaining_refundable into v_remaining
    from public.order_refund_summary(v_ticket.order_id);

  if v_amount > coalesce(v_remaining, 0) then
    raise exception 'That is more than the % remaining on this order', coalesce(v_remaining, 0)
      using errcode = '22023';
  end if;

  insert into public.support_refunds (
    ticket_id, order_id, payment_id, client_request_id, method, liability, amount, currency,
    reason, approved_by
  )
  values (
    p_ticket_id, v_ticket.order_id, v_payment.id, p_client_request_id, v_method, p_liability,
    v_amount, coalesce(v_payment.currency, 'EUR'), v_reason, auth.uid()
  )
  returning * into v_refund;

  if v_method = 'card' then
    insert into public.payment_reconciliations (
      payment_id, order_id, kind, amount, reason, provider_idempotency_key
    )
    values (
      v_payment.id, v_ticket.order_id, 'support_refund', v_amount,
      format('Support refund for ticket %s', p_ticket_id), v_refund.provider_idempotency_key
    )
    returning * into v_reconciliation;

    update public.support_refunds
       set reconciliation_id = v_reconciliation.id, updated_at = now()
     where id = v_refund.id
    returning * into v_refund;
  end if;

  update public.support_tickets
     set revision = revision + 1, updated_at = now()
   where id = p_ticket_id;

  insert into public.admin_actions (admin_id, action, subject_type, subject_id, details)
  values (
    auth.uid(), 'approve_support_refund', 'support_refund', v_refund.id::text,
    jsonb_build_object(
      'ticket_id', p_ticket_id, 'order_id', v_ticket.order_id, 'amount', v_amount,
      'method', v_method, 'liability', p_liability, 'reason', v_reason
    )
  );

  insert into public.notifications (user_id, order_id, audience, kind, title, body, data)
  values (
    v_ticket.user_id, v_ticket.order_id, 'customer', 'support_refund',
    'Refund update', 'There is an update about a refund on your order',
    jsonb_build_object(
      'ticket_id', p_ticket_id, 'order_id', v_ticket.order_id,
      'refund_id', v_refund.id, 'state', 'reserved', 'route', '/order/support-ticket'
    )
  )
  on conflict do nothing;

  return v_refund;
end;
$$;

create or replace function public.settle_support_refund(
  p_refund_id uuid,
  p_state text,
  p_failure_reason text default null
)
returns public.support_refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.platform_settings;
  v_refund public.support_refunds;
  v_restaurant_id uuid;
begin
  select * into s from public.platform_settings where id;

  select * into v_refund from public.support_refunds where id = p_refund_id for update;
  if not found then
    raise exception 'Refund not found' using errcode = 'P0002';
  end if;

  if v_refund.state <> 'reserved' then
    return v_refund;
  end if;

  if p_state not in ('confirmed', 'failed', 'cancelled') then
    raise exception 'Unknown refund state' using errcode = '22023';
  end if;

  update public.support_refunds
     set state = p_state::public.support_refund_state,
         failure_reason = public.sanitize_error_text(p_failure_reason),
         settled_at = now(),
         updated_at = now()
   where id = p_refund_id
  returning * into v_refund;

  if p_state = 'confirmed' and v_refund.liability = 'restaurant' then
    select o.restaurant_id into v_restaurant_id
      from public.orders o where o.id = v_refund.order_id;

    perform public.post_ledger_delta(
      v_refund.order_id, 'restaurant_payout', 'restaurant', v_restaurant_id,
      v_refund.amount, coalesce(s.currency, 'EUR'),
      format('Support refund recovered from the restaurant (%s)', v_refund.id));
  end if;

  insert into public.notifications (user_id, order_id, audience, kind, title, body, data)
  select o.user_id, v_refund.order_id, 'customer', 'support_refund',
         'Refund update',
         case p_state
           when 'confirmed' then 'Your refund is on its way back to you'
           else 'There is an update about a refund on your order'
         end,
         jsonb_build_object(
           'ticket_id', v_refund.ticket_id, 'order_id', v_refund.order_id,
           'refund_id', v_refund.id, 'state', p_state, 'route', '/order/support-ticket'
         )
    from public.orders o where o.id = v_refund.order_id
  on conflict do nothing;

  return v_refund;
end;
$$;

create or replace function public.admin_confirm_cash_refund(
  p_refund_id uuid,
  p_reason text
)
returns public.support_refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.platform_settings;
  v_refund public.support_refunds;
  v_customer_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.require_admin();

  if v_reason is null then
    raise exception 'Confirm how the cash was returned' using errcode = '22023';
  end if;

  select * into s from public.platform_settings where id;

  select * into v_refund from public.support_refunds where id = p_refund_id for update;
  if not found then
    raise exception 'Refund not found' using errcode = 'P0002';
  end if;

  if v_refund.method <> 'cash' then
    raise exception 'Only a cash refund is settled by hand' using errcode = '42501';
  end if;

  if v_refund.state = 'confirmed' then
    return v_refund;
  end if;

  if v_refund.state <> 'reserved' then
    raise exception 'This refund is no longer open' using errcode = '42501';
  end if;

  select o.user_id into v_customer_id
    from public.orders o where o.id = v_refund.order_id;

  perform public.post_ledger_delta(
    v_refund.order_id, 'refund', 'customer', v_customer_id, -v_refund.amount,
    coalesce(s.currency, 'EUR'), format('Cash refund confirmed (%s)', v_reason));

  update public.support_refunds
     set settled_by = auth.uid(), updated_at = now()
   where id = p_refund_id;

  insert into public.admin_actions (admin_id, action, subject_type, subject_id, details)
  values (
    auth.uid(), 'confirm_cash_refund', 'support_refund', p_refund_id::text,
    jsonb_build_object(
      'ticket_id', v_refund.ticket_id, 'order_id', v_refund.order_id,
      'amount', v_refund.amount, 'reason', v_reason
    )
  );

  return public.settle_support_refund(p_refund_id, 'confirmed', null);
end;
$$;

create or replace function public.support_refunds_for_ticket(p_ticket_id uuid)
returns table (
  id uuid,
  amount numeric,
  currency text,
  method text,
  liability text,
  state public.support_refund_state,
  reason text,
  failure_reason text,
  approved_at timestamptz,
  settled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.support_ticket_role(p_ticket_id) is null then
    raise exception 'You cannot read this ticket' using errcode = '42501';
  end if;

  return query
  select sr.id, sr.amount, sr.currency, sr.method, sr.liability, sr.state,
         sr.reason, sr.failure_reason, sr.approved_at, sr.settled_at
    from public.support_refunds sr
   where sr.ticket_id = p_ticket_id
   order by sr.approved_at desc;
end;
$$;

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
    when p_kind = 'order_message' then
      case
        when p_order_id is null then false
        else exists (
          select 1 from public.orders o where o.id = p_order_id and o.user_id = p_user_id
        ) or exists (
          select 1 from public.deliveries d
           where d.order_id = p_order_id and d.courier_id = p_user_id
        )
      end
    when p_kind in ('support_message', 'support_status', 'support_refund') then
      case
        when p_order_id is null then false
        else exists (
          select 1 from public.orders o where o.id = p_order_id and o.user_id = p_user_id
        )
      end
    else true
  end;
$$;

revoke all on function public.support_ticket_role(uuid) from public, anon;
revoke all on function public.support_report_window_days() from public, anon;
revoke all on function public.support_max_tickets_per_order() from public, anon;
revoke all on function public.support_max_reopens() from public, anon;
revoke all on function public.support_report_eligibility(uuid) from public, anon;
revoke all on function public.submit_support_ticket(uuid, uuid, text, text, jsonb) from public, anon;
revoke all on function public.support_messages_page(uuid, timestamptz, uuid, int) from public, anon;
revoke all on function public.send_support_message(uuid, uuid, text) from public, anon;
revoke all on function public.my_support_tickets(int, int) from public, anon;
revoke all on function public.support_ticket_details(uuid) from public, anon;
revoke all on function public.support_ticket_reported_items(uuid) from public, anon;
revoke all on function public.order_refund_summary(uuid) from public, anon;
revoke all on function public.admin_support_tickets(text, text, text, int, int) from public, anon;
revoke all on function public.admin_assign_support_ticket(uuid, uuid, int) from public, anon;
revoke all on function public.admin_set_support_status(uuid, text, int, text) from public, anon;
revoke all on function public.admin_approve_support_refund(uuid, numeric, text, text, uuid)
  from public, anon;
revoke all on function public.admin_confirm_cash_refund(uuid, text) from public, anon;
revoke all on function public.support_refunds_for_ticket(uuid) from public, anon;
revoke all on function public.settle_support_refund(uuid, text, text) from public, anon, authenticated;
revoke all on function public.notification_recipient_still_authorised(text, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.support_ticket_role(uuid) to authenticated;
grant execute on function public.support_report_window_days() to authenticated;
grant execute on function public.support_max_tickets_per_order() to authenticated;
grant execute on function public.support_max_reopens() to authenticated;
grant execute on function public.support_report_eligibility(uuid) to authenticated;
grant execute on function public.submit_support_ticket(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.support_messages_page(uuid, timestamptz, uuid, int) to authenticated;
grant execute on function public.send_support_message(uuid, uuid, text) to authenticated;
grant execute on function public.my_support_tickets(int, int) to authenticated;
grant execute on function public.support_ticket_details(uuid) to authenticated;
grant execute on function public.support_ticket_reported_items(uuid) to authenticated;
grant execute on function public.order_refund_summary(uuid) to authenticated;
grant execute on function public.admin_support_tickets(text, text, text, int, int) to authenticated;
grant execute on function public.admin_assign_support_ticket(uuid, uuid, int) to authenticated;
grant execute on function public.admin_set_support_status(uuid, text, int, text) to authenticated;
grant execute on function public.admin_approve_support_refund(uuid, numeric, text, text, uuid)
  to authenticated;
grant execute on function public.admin_confirm_cash_refund(uuid, text) to authenticated;
grant execute on function public.support_refunds_for_ticket(uuid) to authenticated;
grant execute on function public.settle_support_refund(uuid, text, text) to service_role;

create or replace function public.post_ledger_delta(
  p_order_id uuid,
  p_entry_type public.ledger_entry_type,
  p_party_type text,
  p_party_id uuid,
  p_amount numeric,
  p_currency text default 'EUR',
  p_memo text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ledger_entries (
    order_id, entry_type, party_type, party_id, amount, currency, memo
  )
  values (
    p_order_id, p_entry_type, p_party_type, p_party_id, p_amount,
    coalesce(p_currency, 'EUR'), p_memo
  )
  on conflict (
    order_id, entry_type, party_type,
    coalesce(party_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  do update set
    amount = ledger_entries.amount + excluded.amount,
    memo = coalesce(excluded.memo, ledger_entries.memo);
$$;

create or replace function public.record_refund(
  p_provider_intent_id text,
  p_provider_refund_id text,
  p_amount numeric,
  p_reason text default null,
  p_provider_event_id text default null,
  p_payload jsonb default '{}'::jsonb
)
returns public.refunds
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.platform_settings;
  v_payment public.payments;
  v_order public.orders;
  v_refund public.refunds;
  v_refunded numeric(10,2);
begin
  select * into s from public.platform_settings where id;

  select * into v_payment
    from public.payments
   where provider_intent_id = p_provider_intent_id
   for update;

  if not found then
    raise exception 'Unknown payment intent' using errcode = '23503';
  end if;

  if p_amount <= 0 or p_amount > v_payment.amount - v_payment.amount_refunded then
    raise exception 'Refund amount exceeds the remaining balance' using errcode = '22023';
  end if;

  insert into public.refunds (payment_id, order_id, provider_refund_id, amount, reason, requested_by)
  values (v_payment.id, v_payment.order_id, p_provider_refund_id, p_amount, p_reason, auth.uid())
  on conflict (provider_refund_id) do nothing
  returning * into v_refund;

  if v_refund.id is null then
    select * into v_refund from public.refunds where provider_refund_id = p_provider_refund_id;
    return v_refund;
  end if;

  insert into public.payment_transactions (
    payment_id, provider_event_id, event_type, status, amount, payload
  )
  values (v_payment.id, p_provider_event_id, 'charge.refunded', 'refunded',
          p_amount, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider_event_id) do nothing;

  v_refunded := v_payment.amount_refunded + p_amount;

  update public.payments
     set amount_refunded = v_refunded,
         status = case when v_refunded >= amount then 'refunded' else status end
   where id = v_payment.id;

  perform public.post_ledger_delta(
    v_payment.order_id, 'refund', 'customer', v_payment.user_id, -p_amount,
    s.currency, p_reason);

  select * into v_order from public.orders where id = v_payment.order_id;

  if v_refunded >= v_payment.amount and v_order.status not in ('refunded', 'delivered') then
    begin
      perform public.transition_order_status(
        v_payment.order_id, 'refunded'::public.order_status, p_reason);
    exception when others then
      null;
    end;
  end if;

  return v_refund;
end;
$$;

create or replace function public.resolve_payment_reconciliation(
  p_id uuid,
  p_provider_refund_id text,
  p_provider_event_id text default null,
  p_payload jsonb default '{}'::jsonb
)
returns public.payment_reconciliations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payment_reconciliations;
  v_payment public.payments;
  v_refund public.refunds;
  v_support_refund_id uuid;
  v_outstanding numeric(10,2);
begin
  select * into v_row from public.payment_reconciliations where id = p_id for update;
  if not found then
    raise exception 'Unknown reconciliation' using errcode = 'P0002';
  end if;

  if v_row.state = 'resolved' then
    return v_row;
  end if;

  select id into v_support_refund_id
    from public.support_refunds where reconciliation_id = p_id for update;

  select * into v_payment from public.payments where id = v_row.payment_id for update;
  v_outstanding := v_payment.amount - v_payment.amount_refunded;

  if v_outstanding <= 0 then
    update public.payment_reconciliations
       set state = 'resolved',
           provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id),
           provider_status = 'already_refunded',
           resolved_at = now(),
           locked_at = null,
           last_error = null,
           updated_at = now()
     where id = p_id
    returning * into v_row;

    if v_support_refund_id is not null then
      perform public.settle_support_refund(
        v_support_refund_id, 'failed', 'The payment had already been refunded in full');
    end if;

    return v_row;
  end if;

  v_refund := public.record_refund(
    v_payment.provider_intent_id,
    p_provider_refund_id,
    least(v_row.amount, v_outstanding),
    v_row.reason,
    p_provider_event_id,
    coalesce(p_payload, '{}'::jsonb)
  );

  update public.payment_reconciliations
     set state = 'resolved',
         resolved_refund_id = v_refund.id,
         provider_refund_id = p_provider_refund_id,
         provider_status = 'succeeded',
         resolved_at = now(),
         locked_at = null,
         last_error = null,
         updated_at = now()
   where id = p_id
  returning * into v_row;

  if v_support_refund_id is not null then
    perform public.settle_support_refund(v_support_refund_id, 'confirmed', null);
  end if;

  return v_row;
end;
$$;

create or replace function public.fail_payment_reconciliation(p_id uuid, p_error text)
returns public.payment_reconciliations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payment_reconciliations;
  v_support_refund_id uuid;
begin
  perform 1 from public.payment_reconciliations where id = p_id for update;

  select id into v_support_refund_id
    from public.support_refunds where reconciliation_id = p_id for update;

  update public.payment_reconciliations
     set last_error = public.sanitize_error_text(p_error),
         state = case when attempts >= 10 then 'abandoned' else 'pending' end,
         locked_at = null,
         updated_at = now()
   where id = p_id
     and state <> 'resolved'
  returning * into v_row;

  if v_row.id is not null and v_row.state = 'abandoned' and v_support_refund_id is not null then
    perform public.settle_support_refund(v_support_refund_id, 'failed', p_error);
  end if;

  return v_row;
end;
$$;

create or replace function public.admin_retry_payment_reconciliation(
  p_id uuid,
  p_reason text
)
returns public.payment_reconciliations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payment_reconciliations;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_support_refund public.support_refunds;
  v_remaining numeric(10,2);
begin
  perform public.require_admin();

  if v_reason is null then
    raise exception 'A reason is required to retry a refund' using errcode = '22023';
  end if;

  select * into v_row from public.payment_reconciliations where id = p_id for update;

  if not found then
    raise exception 'Unknown reconciliation' using errcode = 'P0002';
  end if;

  if v_row.state = 'resolved' then
    raise exception 'This refund is already settled' using errcode = '42501';
  end if;

  if v_row.state = 'in_progress' and v_row.next_attempt_at > now() then
    raise exception 'A worker is already retrying this refund' using errcode = '55006';
  end if;

  select * into v_support_refund
    from public.support_refunds where reconciliation_id = p_id for update;

  if v_support_refund.id is not null and v_support_refund.state = 'failed' then
    select remaining_refundable into v_remaining
      from public.order_refund_summary(v_support_refund.order_id);

    if coalesce(v_remaining, 0) < v_support_refund.amount then
      raise exception 'The order can no longer cover this refund' using errcode = '22023';
    end if;

    update public.support_refunds
       set state = 'reserved',
           failure_reason = null,
           settled_at = null,
           updated_at = now()
     where id = v_support_refund.id;
  end if;

  update public.payment_reconciliations
     set state = 'pending',
         next_attempt_at = now(),
         locked_at = null,
         updated_at = now()
   where id = p_id
  returning * into v_row;

  insert into public.admin_actions (admin_id, action, subject_type, subject_id, details)
  values (
    auth.uid(),
    'retry_payment_reconciliation',
    'payment_reconciliation',
    p_id::text,
    jsonb_build_object(
      'reason', v_reason,
      'attempts', v_row.attempts,
      'order_id', v_row.order_id,
      'amount', v_row.amount
    )
  );

  return v_row;
end;
$$;

revoke all on function public.post_ledger_delta(
  uuid, public.ledger_entry_type, text, uuid, numeric, text, text) from public, anon, authenticated;
revoke all on function public.record_refund(text, text, numeric, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.resolve_payment_reconciliation(uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.fail_payment_reconciliation(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_retry_payment_reconciliation(uuid, text) from public, anon;
grant execute on function public.admin_retry_payment_reconciliation(uuid, text) to authenticated;

drop function if exists public.claim_payment_reconciliations(int, int);

create or replace function public.claim_payment_reconciliations(
  p_limit int default 20,
  p_lease_seconds int default 300
)
returns table (
  reconciliation_id uuid,
  payment_id uuid,
  order_id uuid,
  kind text,
  provider_intent_id text,
  provider_charge_id text,
  amount numeric,
  payment_amount numeric,
  currency text,
  reason text,
  provider_idempotency_key uuid,
  attempts int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_lease int := least(greatest(coalesce(p_lease_seconds, 300), 30), 3600);
begin
  return query
  with claimed as (
    update public.payment_reconciliations r
       set state = 'in_progress',
           attempts = r.attempts + 1,
           locked_at = now(),
           last_attempt_at = now(),
           next_attempt_at = now() + make_interval(
             secs => greatest(v_lease, least(3600, (30 * power(2, r.attempts))::int))
           ),
           updated_at = now()
     where r.id in (
       select c.id
         from public.payment_reconciliations c
        where c.state in ('pending', 'in_progress')
          and c.next_attempt_at <= now()
        order by c.next_attempt_at
        limit v_limit
        for update skip locked
     )
    returning r.*
  )
  select c.id, c.payment_id, c.order_id, c.kind, p.provider_intent_id, p.provider_charge_id,
         c.amount, p.amount, p.currency, c.reason, c.provider_idempotency_key, c.attempts
    from claimed c
    join public.payments p on p.id = c.payment_id;
end;
$$;

revoke all on function public.claim_payment_reconciliations(int, int) from public, anon, authenticated;

create table if not exists public.support_message_reads (
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ticket_id, user_id)
);

alter table public.support_message_reads enable row level security;

drop policy if exists support_message_reads_select on public.support_message_reads;
create policy support_message_reads_select on public.support_message_reads
  for select to authenticated
  using (user_id = auth.uid());

create or replace function public.mark_support_messages_read(p_ticket_id uuid)
returns public.support_message_reads
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.support_message_reads;
begin
  if public.support_ticket_role(p_ticket_id) is null then
    raise exception 'You cannot read this ticket' using errcode = '42501';
  end if;

  insert into public.support_message_reads (ticket_id, user_id, last_read_at, updated_at)
  values (p_ticket_id, auth.uid(), now(), now())
  on conflict (ticket_id, user_id) do update
     set last_read_at = now(), updated_at = now()
  returning * into v_row;

  update public.notifications n
     set read_at = now()
   where n.user_id = auth.uid()
     and n.kind in ('support_message', 'support_status', 'support_refund')
     and n.read_at is null
     and n.data ->> 'ticket_id' = p_ticket_id::text;

  return v_row;
end;
$$;

create or replace function public.support_unread_count(p_ticket_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.support_ticket_role(p_ticket_id) is null then 0
    else (
      select count(*)::int
        from public.support_messages m
        left join public.support_message_reads r
          on r.ticket_id = m.ticket_id and r.user_id = auth.uid()
       where m.ticket_id = p_ticket_id
         and m.sender_id <> auth.uid()
         and (r.last_read_at is null or m.created_at > r.last_read_at)
    )
  end;
$$;

create or replace function public.my_support_tickets(
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  order_id uuid,
  restaurant_name text,
  category public.support_category,
  status public.support_ticket_status,
  description text,
  created_at timestamptz,
  updated_at timestamptz,
  unread_count int,
  refunded_amount numeric,
  pending_refund numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.order_id,
    r.name as restaurant_name,
    t.category,
    t.status,
    t.description,
    t.created_at,
    t.updated_at,
    (
      select count(*)::int
        from public.support_messages m
        left join public.support_message_reads mr
          on mr.ticket_id = m.ticket_id and mr.user_id = t.user_id
       where m.ticket_id = t.id
         and m.sender_id <> t.user_id
         and (mr.last_read_at is null or m.created_at > mr.last_read_at)
    ) as unread_count,
    coalesce((
      select sum(sr.amount) from public.support_refunds sr
       where sr.ticket_id = t.id and sr.state = 'confirmed'
    ), 0) as refunded_amount,
    coalesce((
      select sum(sr.amount) from public.support_refunds sr
       where sr.ticket_id = t.id and sr.state = 'reserved'
    ), 0) as pending_refund
  from public.support_tickets t
  join public.orders o on o.id = t.order_id
  join public.restaurants r on r.id = o.restaurant_id
 where t.user_id = auth.uid()
 order by t.updated_at desc, t.id
 limit public.search_page_size(p_limit)
offset public.search_page_offset(p_offset);
$$;

do $$
declare v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;

  foreach v_table in array array['support_messages', 'support_tickets', 'support_refunds']
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end
$$;

revoke all on table public.support_message_reads from public, anon, authenticated;
grant select on table public.support_message_reads to authenticated;

revoke all on function public.mark_support_messages_read(uuid) from public, anon;
grant execute on function public.mark_support_messages_read(uuid) to authenticated;

revoke all on function public.support_unread_count(uuid) from public, anon;
grant execute on function public.support_unread_count(uuid) to authenticated;

revoke all on function public.my_support_tickets(int, int) from public, anon;
grant execute on function public.my_support_tickets(int, int) to authenticated;
