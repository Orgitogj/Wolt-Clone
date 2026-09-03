create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in' using errcode = '28000';
  end if;
  if not public.is_admin() then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
end;
$$;

create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users (id) on delete set null,
  action text not null,
  subject_type text not null,
  subject_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_actions_created_at_idx
  on public.admin_actions (created_at desc);
create index if not exists admin_actions_subject_idx
  on public.admin_actions (subject_type, subject_id);

alter table public.admin_actions enable row level security;

drop policy if exists "read admin actions" on public.admin_actions;
create policy "read admin actions" on public.admin_actions
  for select using (public.is_admin());

create or replace function public.log_admin_action(
  p_action text,
  p_subject_type text,
  p_subject_id text,
  p_details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.admin_actions (admin_id, action, subject_type, subject_id, details)
  values (auth.uid(), p_action, p_subject_type, p_subject_id, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function public.admin_set_user_role(
  p_user_id uuid,
  p_role public.user_role
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_previous public.user_role;
begin
  perform public.require_admin();

  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;

  select role into v_previous from public.profiles where id = p_user_id;
  if not found then
    raise exception 'User not found' using errcode = '23503';
  end if;

  if v_previous = 'admin' and p_role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'The last administrator cannot be demoted' using errcode = '42501';
  end if;

  update public.profiles
     set role = p_role
   where id = p_user_id
   returning * into v_profile;

  perform public.log_admin_action(
    'set_user_role', 'profile', p_user_id::text,
    jsonb_build_object('from', v_previous, 'to', p_role));

  return v_profile;
end;
$$;

create or replace function public.admin_review_courier(
  p_courier_id uuid,
  p_status public.verification_status,
  p_notes text default null
)
returns public.couriers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_courier public.couriers;
  v_previous public.verification_status;
begin
  perform public.require_admin();

  select verification_status into v_previous from public.couriers where id = p_courier_id;
  if not found then
    raise exception 'Courier not found' using errcode = '23503';
  end if;

  if p_status <> 'approved' and exists (
    select 1 from public.deliveries d
     where d.courier_id = p_courier_id
       and d.status in ('assigned', 'picked_up', 'delivering')
  ) then
    raise exception 'Reassign the active delivery before withdrawing this courier'
      using errcode = '42501';
  end if;

  update public.couriers
     set verification_status = p_status,
         verification_notes = nullif(btrim(coalesce(p_notes, '')), ''),
         availability = case when p_status = 'approved' then availability else 'offline' end
   where id = p_courier_id
   returning * into v_courier;

  perform public.log_admin_action(
    'review_courier', 'courier', p_courier_id::text,
    jsonb_build_object('from', v_previous, 'to', p_status, 'notes', p_notes));

  return v_courier;
end;
$$;

create or replace function public.admin_review_courier_document(
  p_document_id uuid,
  p_status public.verification_status,
  p_notes text default null
)
returns public.courier_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.courier_documents;
begin
  perform public.require_admin();

  update public.courier_documents
     set status = p_status,
         notes = nullif(btrim(coalesce(p_notes, '')), ''),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_document_id
   returning * into v_document;

  if not found then
    raise exception 'Document not found' using errcode = '23503';
  end if;

  perform public.log_admin_action(
    'review_courier_document', 'courier_document', p_document_id::text,
    jsonb_build_object('to', p_status));

  return v_document;
end;
$$;

create or replace function public.admin_set_restaurant_member(
  p_restaurant_id uuid,
  p_user_id uuid,
  p_role text default 'owner'
)
returns public.restaurant_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.restaurant_members;
begin
  perform public.require_admin();

  if p_role not in ('owner', 'manager', 'staff') then
    raise exception 'Invalid restaurant role: %', p_role using errcode = '22023';
  end if;

  if not exists (select 1 from public.restaurants where id = p_restaurant_id) then
    raise exception 'Restaurant not found' using errcode = '23503';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'User not found' using errcode = '23503';
  end if;

  insert into public.restaurant_members (restaurant_id, user_id, role)
  values (p_restaurant_id, p_user_id, p_role)
  on conflict (restaurant_id, user_id) do update set role = excluded.role
  returning * into v_member;

  perform public.log_admin_action(
    'set_restaurant_member', 'restaurant', p_restaurant_id::text,
    jsonb_build_object('user_id', p_user_id, 'role', p_role));

  return v_member;
end;
$$;

create or replace function public.admin_remove_restaurant_member(
  p_restaurant_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  perform public.require_admin();

  delete from public.restaurant_members
   where restaurant_id = p_restaurant_id
     and user_id = p_user_id;

  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    raise exception 'That user does not manage this restaurant' using errcode = '23503';
  end if;

  perform public.log_admin_action(
    'remove_restaurant_member', 'restaurant', p_restaurant_id::text,
    jsonb_build_object('user_id', p_user_id));
end;
$$;

create or replace function public.admin_update_platform_settings(p_patch jsonb)
returns public.platform_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed text[] := array[
    'currency', 'service_fee', 'delivery_base_fee', 'delivery_base_distance_km',
    'delivery_per_km_fee', 'fallback_distance_km', 'max_delivery_distance_km', 'max_tip',
    'max_item_quantity', 'scheduling_grace_minutes', 'max_schedule_days_ahead',
    'default_timezone', 'delivery_offer_timeout_seconds', 'courier_search_radius_km',
    'courier_base_fee', 'courier_per_km_fee', 'max_delivery_offers', 'commission_rate',
    'card_payments_enabled', 'payment_hold_minutes'
  ];
  v_key text;
  v_current public.platform_settings;
  v_next public.platform_settings;
  v_settings public.platform_settings;
begin
  perform public.require_admin();

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'A settings object is required' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(p_patch)
  loop
    if not (v_key = any (v_allowed)) then
      raise exception 'platform_settings.% cannot be changed here', v_key using errcode = '22023';
    end if;
  end loop;

  select * into v_current from public.platform_settings where id;
  v_next := jsonb_populate_record(v_current, p_patch);

  if v_next.currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three letter code' using errcode = '22023';
  end if;

  if not exists (select 1 from pg_timezone_names where name = v_next.default_timezone) then
    raise exception 'Unknown timezone: %', v_next.default_timezone using errcode = '22023';
  end if;

  update public.platform_settings
     set currency = v_next.currency,
         service_fee = v_next.service_fee,
         delivery_base_fee = v_next.delivery_base_fee,
         delivery_base_distance_km = v_next.delivery_base_distance_km,
         delivery_per_km_fee = v_next.delivery_per_km_fee,
         fallback_distance_km = v_next.fallback_distance_km,
         max_delivery_distance_km = v_next.max_delivery_distance_km,
         max_tip = v_next.max_tip,
         max_item_quantity = v_next.max_item_quantity,
         scheduling_grace_minutes = v_next.scheduling_grace_minutes,
         max_schedule_days_ahead = v_next.max_schedule_days_ahead,
         default_timezone = v_next.default_timezone,
         delivery_offer_timeout_seconds = v_next.delivery_offer_timeout_seconds,
         courier_search_radius_km = v_next.courier_search_radius_km,
         courier_base_fee = v_next.courier_base_fee,
         courier_per_km_fee = v_next.courier_per_km_fee,
         max_delivery_offers = v_next.max_delivery_offers,
         commission_rate = v_next.commission_rate,
         card_payments_enabled = v_next.card_payments_enabled,
         payment_hold_minutes = v_next.payment_hold_minutes,
         updated_at = now()
   where id
   returning * into v_settings;

  perform public.log_admin_action('update_platform_settings', 'platform_settings', 'true', p_patch);

  return v_settings;
end;
$$;

create or replace function public.admin_assign_delivery(
  p_delivery_id uuid,
  p_courier_id uuid
)
returns public.deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery public.deliveries;
  v_previous uuid;
begin
  perform public.require_admin();

  select * into v_delivery from public.deliveries where id = p_delivery_id for update;
  if not found then
    raise exception 'Delivery not found' using errcode = '23503';
  end if;

  if v_delivery.status not in ('pending', 'assigned') then
    raise exception 'A delivery cannot be reassigned once it is %', v_delivery.status
      using errcode = '42501';
  end if;

  if not public.is_approved_courier(p_courier_id) then
    raise exception 'That courier is not approved' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.deliveries d
     where d.courier_id = p_courier_id
       and d.id <> p_delivery_id
       and d.status in ('assigned', 'picked_up', 'delivering')
  ) then
    raise exception 'That courier is already on a delivery' using errcode = '42501';
  end if;

  v_previous := v_delivery.courier_id;

  update public.deliveries
     set courier_id = p_courier_id,
         status = 'assigned',
         assigned_at = now()
   where id = p_delivery_id
   returning * into v_delivery;

  update public.delivery_offers
     set status = 'expired', responded_at = now()
   where delivery_id = p_delivery_id
     and status = 'pending';

  if v_previous is not null and v_previous <> p_courier_id then
    update public.couriers set availability = 'online' where id = v_previous;
  end if;

  update public.couriers set availability = 'busy' where id = p_courier_id;

  perform public.transition_order_status(v_delivery.order_id, 'courier_assigned');

  perform public.log_admin_action(
    'assign_delivery', 'delivery', p_delivery_id::text,
    jsonb_build_object('from', v_previous, 'to', p_courier_id));

  return v_delivery;
end;
$$;

create or replace view public.admin_overview as
select
  (select count(*) from public.orders
    where created_at >= date_trunc('day', now()))::int as orders_today,
  (select coalesce(sum(total), 0) from public.orders
    where created_at >= date_trunc('day', now())
      and status not in ('pending_payment', 'payment_failed', 'cancelled', 'restaurant_rejected')
  ) as gmv_today,
  (select coalesce(sum(amount), 0) from public.ledger_entries
    where entry_type = 'platform_commission'
      and created_at >= date_trunc('day', now())) as commission_today,
  (select coalesce(-sum(amount), 0) from public.ledger_entries
    where entry_type = 'refund'
      and created_at >= date_trunc('day', now())) as refunds_today,
  (select count(*) from public.orders
    where status in ('placed', 'accepted', 'preparing', 'ready_for_pickup',
                     'courier_assigned', 'picked_up', 'delivering'))::int as active_orders,
  (select count(*) from public.orders
    where status = 'pending_payment')::int as awaiting_payment,
  (select count(*) from public.deliveries
    where status = 'pending')::int as unassigned_deliveries,
  (select count(*) from public.couriers
    where verification_status = 'pending')::int as pending_couriers,
  (select count(*) from public.couriers
    where availability in ('online', 'busy')
      and verification_status = 'approved')::int as online_couriers,
  (select count(*) from public.profiles)::int as total_users,
  (select count(*) from public.restaurants)::int as total_restaurants
where public.is_admin();

create or replace view public.admin_daily_revenue as
select (o.created_at at time zone s.default_timezone)::date as day,
       count(*)::int as orders,
       round(coalesce(sum(o.total), 0), 2) as gmv,
       round(coalesce(sum(c.commission), 0), 2) as commission
  from public.orders o
  cross join public.platform_settings s
  left join lateral (
    select sum(l.amount) as commission
      from public.ledger_entries l
     where l.order_id = o.id
       and l.entry_type = 'platform_commission'
  ) c on true
 where public.is_admin()
   and o.created_at >= now() - interval '30 days'
   and o.status not in ('pending_payment', 'payment_failed', 'cancelled', 'restaurant_rejected')
 group by 1
 order by 1 desc;

create or replace view public.admin_orders as
select o.id as order_id,
       o.created_at,
       o.status,
       o.delivery_mode,
       o.payment_method,
       o.subtotal,
       o.tip_amount,
       o.total,
       o.scheduled_for,
       o.restaurant_id,
       r.name as restaurant_name,
       o.user_id as customer_id,
       p.full_name as customer_name,
       u.email as customer_email,
       coalesce(pay.status::text, 'uncollected') as payment_status,
       coalesce(pay.amount_refunded, 0) as amount_refunded,
       d.id as delivery_id,
       d.status::text as delivery_status,
       d.courier_id,
       c.full_name as courier_name
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  left join public.profiles p on p.id = o.user_id
  left join auth.users u on u.id = o.user_id
  left join public.payments pay on pay.order_id = o.id
  left join public.deliveries d on d.order_id = o.id
  left join public.couriers c on c.id = d.courier_id
 where public.is_admin();

create or replace view public.admin_couriers as
select c.id,
       c.full_name,
       c.phone,
       c.vehicle_type,
       c.vehicle_plate,
       c.availability,
       c.verification_status,
       c.verification_notes,
       c.current_latitude,
       c.current_longitude,
       c.location_updated_at,
       c.created_at,
       u.email,
       (select count(*) from public.courier_documents d
         where d.courier_id = c.id)::int as document_count,
       (select count(*) from public.courier_documents d
         where d.courier_id = c.id and d.status = 'approved')::int as approved_documents,
       (select count(*) from public.deliveries dl
         where dl.courier_id = c.id and dl.status = 'delivered')::int as completed_deliveries,
       (select coalesce(sum(e.total), 0) from public.courier_earnings e
         where e.courier_id = c.id) as lifetime_earnings
  from public.couriers c
  join auth.users u on u.id = c.id
 where public.is_admin();

create or replace view public.admin_users as
select p.id,
       p.full_name,
       p.phone,
       p.role,
       p.created_at,
       u.email,
       (select count(*) from public.orders o where o.user_id = p.id)::int as order_count,
       (select coalesce(sum(o.total), 0) from public.orders o
         where o.user_id = p.id and o.status = 'delivered') as lifetime_value,
       exists (select 1 from public.couriers c where c.id = p.id) as is_courier,
       (select coalesce(array_agg(r.name order by r.name), '{}'::text[])
          from public.restaurant_members m
          join public.restaurants r on r.id = m.restaurant_id
         where m.user_id = p.id) as managed_restaurants
  from public.profiles p
  join auth.users u on u.id = p.id
 where public.is_admin();

revoke all on public.admin_overview from public, anon;
revoke all on public.admin_daily_revenue from public, anon;
revoke all on public.admin_orders from public, anon;
revoke all on public.admin_couriers from public, anon;
revoke all on public.admin_users from public, anon;

grant select on public.admin_overview to authenticated;
grant select on public.admin_daily_revenue to authenticated;
grant select on public.admin_orders to authenticated;
grant select on public.admin_couriers to authenticated;
grant select on public.admin_users to authenticated;

revoke all on function public.require_admin() from public;
revoke all on function public.log_admin_action(text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.admin_set_user_role(uuid, public.user_role) from public, anon;
revoke all on function public.admin_review_courier(uuid, public.verification_status, text)
  from public, anon;
revoke all on function public.admin_review_courier_document(uuid, public.verification_status, text)
  from public, anon;
revoke all on function public.admin_set_restaurant_member(uuid, uuid, text) from public, anon;
revoke all on function public.admin_remove_restaurant_member(uuid, uuid) from public, anon;
revoke all on function public.admin_update_platform_settings(jsonb) from public, anon;
revoke all on function public.admin_assign_delivery(uuid, uuid) from public, anon;

grant execute on function public.require_admin() to authenticated;
grant execute on function public.admin_set_user_role(uuid, public.user_role) to authenticated;
grant execute on function public.admin_review_courier(uuid, public.verification_status, text)
  to authenticated;
grant execute on function public.admin_review_courier_document(uuid, public.verification_status, text)
  to authenticated;
grant execute on function public.admin_set_restaurant_member(uuid, uuid, text) to authenticated;
grant execute on function public.admin_remove_restaurant_member(uuid, uuid) to authenticated;
grant execute on function public.admin_update_platform_settings(jsonb) to authenticated;
grant execute on function public.admin_assign_delivery(uuid, uuid) to authenticated;

revoke insert, update, delete on public.admin_actions from anon, authenticated;
