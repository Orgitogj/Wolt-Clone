create or replace view public.order_financials as
select o.id as order_id,
       o.restaurant_id,
       o.user_id,
       o.status,
       o.subtotal,
       o.service_fee,
       o.delivery_fee,
       o.tip_amount,
       o.total,
       coalesce(p.status::text, 'uncollected') as payment_status,
       coalesce(p.amount_refunded, 0) as amount_refunded,
       coalesce(sum(l.amount) filter (where l.entry_type = 'charge'), 0) as collected,
       coalesce(-sum(l.amount) filter (where l.entry_type = 'refund'), 0) as refunded,
       coalesce(-sum(l.amount) filter (where l.entry_type = 'restaurant_payout'), 0) as restaurant_payout,
       coalesce(-sum(l.amount) filter (where l.entry_type = 'courier_payout'), 0) as courier_payout,
       coalesce(sum(l.amount) filter (where l.entry_type = 'platform_commission'), 0) as platform_commission,
       coalesce(sum(l.amount) filter (where l.entry_type <> 'platform_commission'), 0) as platform_net
  from public.orders o
  left join public.payments p on p.order_id = o.id
  left join public.ledger_entries l on l.order_id = o.id
 where public.is_admin()
    or o.user_id = auth.uid()
    or public.manages_restaurant(o.restaurant_id)
 group by o.id, p.status, p.amount_refunded;

revoke all on public.order_financials from public, anon;
grant select on public.order_financials to authenticated;

create or replace function public.create_order(
  p_restaurant_id uuid,
  p_items jsonb,
  p_delivery_mode text,
  p_address_id uuid default null,
  p_scheduled_for timestamptz default null,
  p_tip_amount numeric default 0,
  p_payment_method text default 'card',
  p_leave_at_door boolean default false,
  p_send_as_gift boolean default false,
  p_idempotency_key uuid default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.platform_settings;
  v_user_id uuid := auth.uid();
  v_is_anonymous boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  v_order public.orders;
  v_restaurant public.restaurants;
  v_item jsonb;
  v_dish public.dishes%rowtype;
  v_quantity int;
  v_addon_ids uuid[];
  v_addon_count int;
  v_addon_total numeric(8,2);
  v_addons jsonb;
  v_unit_price numeric(8,2);
  v_lines jsonb := '[]'::jsonb;
  v_subtotal numeric(10,2) := 0;
  v_tip numeric(8,2);
  v_service_fee numeric(6,2) := 0;
  v_delivery_fee numeric(6,2) := 0;
  v_distance_km numeric;
  v_from_lat double precision;
  v_from_lon double precision;
  v_haversine double precision;
  v_effective_at timestamptz;
  v_initial_status public.order_status;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to place an order' using errcode = '28000';
  end if;

  if v_is_anonymous then
    raise exception 'Please create an account to place an order' using errcode = '42501';
  end if;

  if p_idempotency_key is not null then
    select * into v_order
      from public.orders
     where user_id = v_user_id
       and idempotency_key = p_idempotency_key;
    if found then
      return v_order;
    end if;
  end if;

  select * into s from public.platform_settings where id;

  if p_delivery_mode not in ('delivery', 'pickup') then
    raise exception 'Invalid delivery mode: %', p_delivery_mode using errcode = '22023';
  end if;

  if p_payment_method not in ('applepay', 'card', 'cash') then
    raise exception 'Invalid payment method: %', p_payment_method using errcode = '22023';
  end if;

  if p_payment_method <> 'cash' and not s.card_payments_enabled then
    raise exception 'Card payments are not available yet' using errcode = '22023';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'An order needs at least one item' using errcode = '22023';
  end if;

  v_effective_at := coalesce(p_scheduled_for, now());

  if p_scheduled_for is not null then
    if p_scheduled_for < now() - make_interval(mins => s.scheduling_grace_minutes) then
      raise exception 'Scheduled delivery time is in the past' using errcode = '22023';
    end if;
    if p_scheduled_for > now() + make_interval(days => s.max_schedule_days_ahead) then
      raise exception 'Orders can be scheduled at most % days ahead', s.max_schedule_days_ahead
        using errcode = '22023';
    end if;
  end if;

  select * into v_restaurant from public.restaurants where id = p_restaurant_id;
  if not found then
    raise exception 'Restaurant not found' using errcode = '23503';
  end if;

  if not public.is_restaurant_open(p_restaurant_id, v_effective_at) then
    raise exception '% is closed at the selected time', v_restaurant.name using errcode = '22023';
  end if;

  if p_delivery_mode = 'delivery' then
    if p_address_id is null then
      raise exception 'A delivery address is required' using errcode = '22023';
    end if;

    select latitude, longitude
      into v_from_lat, v_from_lon
      from public.addresses
     where id = p_address_id
       and user_id = v_user_id;

    if not found then
      raise exception 'Delivery address not found' using errcode = '42501';
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := coalesce((v_item ->> 'quantity')::int, 0);
    if v_quantity <= 0 or v_quantity > s.max_item_quantity then
      raise exception 'Invalid quantity: %', v_quantity using errcode = '22023';
    end if;

    select *
      into v_dish
      from public.dishes
     where id = (v_item ->> 'dish_id')::uuid
       and restaurant_id = p_restaurant_id
       and is_available;

    if not found then
      raise exception 'A dish in your cart is no longer available' using errcode = '22023';
    end if;

    select coalesce(array_agg(value::uuid), '{}'::uuid[])
      into v_addon_ids
      from jsonb_array_elements_text(coalesce(v_item -> 'addon_ids', '[]'::jsonb));

    select coalesce(sum(price_delta), 0),
           coalesce(
             jsonb_agg(
               jsonb_build_object('id', id, 'name', name, 'priceDelta', price_delta)
               order by sort_order
             ),
             '[]'::jsonb
           ),
           count(*)
      into v_addon_total, v_addons, v_addon_count
      from public.dish_addons
     where dish_id = v_dish.id
       and id = any (v_addon_ids);

    if v_addon_count <> coalesce(array_length(v_addon_ids, 1), 0) then
      raise exception 'Unknown add-on for dish %', v_dish.name using errcode = '22023';
    end if;

    v_unit_price := v_dish.price + v_addon_total;
    v_subtotal := v_subtotal + v_unit_price * v_quantity;

    v_lines := v_lines || jsonb_build_object(
      'dish_id', v_dish.id,
      'dish_name', v_dish.name,
      'unit_price', v_unit_price,
      'quantity', v_quantity,
      'addons', v_addons,
      'line_total', v_unit_price * v_quantity
    );
  end loop;

  if v_subtotal < v_restaurant.min_order then
    raise exception 'Minimum order for % is %', v_restaurant.name, v_restaurant.min_order
      using errcode = '22023';
  end if;

  v_service_fee := s.service_fee;

  if p_delivery_mode = 'delivery' then
    v_distance_km := s.fallback_distance_km;

    if v_from_lat is not null and v_from_lon is not null
       and v_restaurant.latitude is not null and v_restaurant.longitude is not null then
      v_distance_km := public.haversine_km(
        v_from_lat, v_from_lon, v_restaurant.latitude, v_restaurant.longitude);

      if v_distance_km > s.max_delivery_distance_km then
        raise exception '% does not deliver to that address', v_restaurant.name
          using errcode = '22023';
      end if;
    end if;

    v_delivery_fee := round(
      (case
         when v_distance_km <= s.delivery_base_distance_km then s.delivery_base_fee
         else s.delivery_base_fee + (v_distance_km - s.delivery_base_distance_km) * s.delivery_per_km_fee
       end)::numeric,
      2
    );
  end if;

  v_tip := round(greatest(coalesce(p_tip_amount, 0), 0), 2);
  if v_tip > s.max_tip then
    raise exception 'Tip amount is too large' using errcode = '22023';
  end if;

  v_initial_status := case
    when p_payment_method = 'cash' then 'placed'::public.order_status
    else 'pending_payment'::public.order_status
  end;

  begin
    insert into public.orders (
      user_id, restaurant_id, status, delivery_mode, address_id, scheduled_for,
      subtotal, service_fee, delivery_fee, tip_amount, total,
      payment_method, leave_at_door, send_as_gift, idempotency_key
    )
    values (
      v_user_id,
      p_restaurant_id,
      v_initial_status,
      p_delivery_mode,
      case when p_delivery_mode = 'delivery' then p_address_id else null end,
      p_scheduled_for,
      v_subtotal,
      v_service_fee,
      v_delivery_fee,
      v_tip,
      v_subtotal + v_service_fee + v_delivery_fee + v_tip,
      p_payment_method,
      coalesce(p_leave_at_door, false),
      coalesce(p_send_as_gift, false),
      p_idempotency_key
    )
    returning * into v_order;
  exception when unique_violation then
    if p_idempotency_key is null then
      raise;
    end if;
    select * into v_order
      from public.orders
     where user_id = v_user_id
       and idempotency_key = p_idempotency_key;
    if not found then
      raise;
    end if;
    return v_order;
  end;

  insert into public.order_items (
    order_id, dish_id, dish_name, unit_price, quantity, addons, line_total
  )
  select v_order.id,
         (line ->> 'dish_id')::uuid,
         line ->> 'dish_name',
         (line ->> 'unit_price')::numeric,
         (line ->> 'quantity')::int,
         line -> 'addons',
         (line ->> 'line_total')::numeric
    from jsonb_array_elements(v_lines) as line;

  insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_role)
  values (v_order.id, null, v_order.status, v_user_id, 'customer');

  if v_initial_status = 'pending_payment' then
    insert into public.payments (order_id, user_id, amount, currency)
    values (v_order.id, v_user_id, v_order.total, s.currency)
    on conflict (order_id) do nothing;
  else
    perform public.post_order_ledger(v_order.id, 'cash');
  end if;

  return v_order;
end;
$$;

revoke all on function public.create_order(
  uuid, jsonb, text, uuid, timestamptz, numeric, text, boolean, boolean, uuid
) from public, anon;
grant execute on function public.create_order(
  uuid, jsonb, text, uuid, timestamptz, numeric, text, boolean, boolean, uuid
) to authenticated;

create or replace function public.post_order_ledger(p_order_id uuid, p_memo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.platform_settings;
  v_order public.orders;
  v_commission numeric(10,2);
begin
  select * into s from public.platform_settings where id;
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return;
  end if;

  v_commission := round(v_order.subtotal * s.commission_rate, 2);

  insert into public.ledger_entries (order_id, entry_type, party_type, party_id, amount, currency, memo)
  values (p_order_id, 'charge', 'customer', v_order.user_id, v_order.total, s.currency, p_memo)
  on conflict do nothing;

  insert into public.ledger_entries (order_id, entry_type, party_type, party_id, amount, currency, memo)
  values (p_order_id, 'restaurant_payout', 'restaurant', v_order.restaurant_id,
          -(v_order.subtotal - v_commission), s.currency, p_memo)
  on conflict do nothing;

  insert into public.ledger_entries (order_id, entry_type, party_type, party_id, amount, currency, memo)
  values (p_order_id, 'platform_commission', 'platform', null, v_commission, s.currency, p_memo)
  on conflict do nothing;
end;
$$;

create or replace function public.confirm_payment(
  p_provider_intent_id text,
  p_provider_charge_id text default null,
  p_provider_event_id text default null,
  p_payload jsonb default '{}'::jsonb
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
  v_order public.orders;
begin
  select * into v_payment
    from public.payments
   where provider_intent_id = p_provider_intent_id
   for update;

  if not found then
    raise exception 'Unknown payment intent' using errcode = '23503';
  end if;

  insert into public.payment_transactions (
    payment_id, provider_event_id, event_type, status, amount, payload
  )
  values (v_payment.id, p_provider_event_id, 'payment_intent.succeeded', 'succeeded',
          v_payment.amount, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider_event_id) do nothing;

  if v_payment.status = 'succeeded' then
    return v_payment;
  end if;

  update public.payments
     set status = 'succeeded',
         provider_charge_id = coalesce(p_provider_charge_id, provider_charge_id),
         failure_reason = null
   where id = v_payment.id
   returning * into v_payment;

  select * into v_order from public.orders where id = v_payment.order_id;

  if v_order.status = 'pending_payment' then
    perform public.transition_order_status(v_payment.order_id, 'placed'::public.order_status);
  end if;

  perform public.post_order_ledger(v_payment.order_id, 'card');

  return v_payment;
end;
$$;

create or replace function public.fail_payment(
  p_provider_intent_id text,
  p_reason text default null,
  p_provider_event_id text default null,
  p_payload jsonb default '{}'::jsonb
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
  v_order public.orders;
begin
  select * into v_payment
    from public.payments
   where provider_intent_id = p_provider_intent_id
   for update;

  if not found then
    raise exception 'Unknown payment intent' using errcode = '23503';
  end if;

  insert into public.payment_transactions (
    payment_id, provider_event_id, event_type, status, amount, payload
  )
  values (v_payment.id, p_provider_event_id, 'payment_intent.payment_failed', 'failed',
          0, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider_event_id) do nothing;

  if v_payment.status in ('succeeded', 'refunded') then
    return v_payment;
  end if;

  update public.payments
     set status = 'failed',
         failure_reason = p_reason
   where id = v_payment.id
   returning * into v_payment;

  select * into v_order from public.orders where id = v_payment.order_id;

  if v_order.status = 'pending_payment' then
    perform public.transition_order_status(
      v_payment.order_id, 'payment_failed'::public.order_status, p_reason);
  end if;

  return v_payment;
end;
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

  update public.payments
     set amount_refunded = amount_refunded + p_amount,
         status = case when amount_refunded + p_amount >= amount then 'refunded' else status end
   where id = v_payment.id;

  insert into public.ledger_entries (order_id, entry_type, party_type, party_id, amount, currency, memo)
  values (v_payment.order_id, 'refund', 'customer', v_payment.user_id, -p_amount, s.currency, p_reason)
  on conflict do nothing;

  select * into v_order from public.orders where id = v_payment.order_id;

  if v_order.status not in ('refunded', 'delivered') then
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

create or replace function public.expire_unpaid_orders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.platform_settings;
  v_order record;
  v_count int := 0;
begin
  select * into s from public.platform_settings where id;

  for v_order in
    select id from public.orders
     where status = 'pending_payment'
       and created_at < now() - make_interval(mins => s.payment_hold_minutes)
     limit 200
  loop
    perform public.transition_order_status(
      v_order.id, 'payment_failed'::public.order_status, 'Payment was not completed in time');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.courier_advance_delivery(
  p_delivery_id uuid,
  p_to public.delivery_status
)
returns public.deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.platform_settings;
  v_delivery public.deliveries;
  v_order public.orders;
  v_base numeric(8,2);
  v_distance_fee numeric(8,2);
  v_tip numeric(8,2);
  v_total numeric(8,2);
begin
  select * into v_delivery from public.deliveries where id = p_delivery_id for update;
  if not found or v_delivery.courier_id is distinct from auth.uid() then
    raise exception 'Delivery not found' using errcode = '42501';
  end if;

  if not (
    (v_delivery.status = 'assigned' and p_to = 'picked_up')
    or (v_delivery.status = 'picked_up' and p_to = 'delivering')
    or (v_delivery.status = 'delivering' and p_to = 'delivered')
  ) then
    raise exception 'Cannot move a delivery from % to %', v_delivery.status, p_to
      using errcode = '42501';
  end if;

  update public.deliveries
     set status = p_to,
         picked_up_at = case when p_to = 'picked_up' then now() else picked_up_at end,
         delivered_at = case when p_to = 'delivered' then now() else delivered_at end
   where id = p_delivery_id
   returning * into v_delivery;

  perform public.transition_order_status(
    v_delivery.order_id,
    case p_to
      when 'picked_up' then 'picked_up'::public.order_status
      when 'delivering' then 'delivering'::public.order_status
      else 'delivered'::public.order_status
    end
  );

  if p_to = 'delivered' then
    select * into s from public.platform_settings where id;
    select * into v_order from public.orders where id = v_delivery.order_id;

    v_base := s.courier_base_fee;
    v_distance_fee := round(coalesce(v_delivery.distance_km, 0) * s.courier_per_km_fee, 2);
    v_tip := coalesce(v_order.tip_amount, 0);
    v_total := v_base + v_distance_fee + v_tip;

    insert into public.courier_earnings (courier_id, delivery_id, base_fee, distance_fee, tip, total)
    values (v_delivery.courier_id, v_delivery.id, v_base, v_distance_fee, v_tip, v_total)
    on conflict (delivery_id) do nothing;

    insert into public.ledger_entries (
      order_id, entry_type, party_type, party_id, amount, currency, memo
    )
    values (v_delivery.order_id, 'courier_payout', 'courier', v_delivery.courier_id,
            -v_total, s.currency, 'delivery completed')
    on conflict do nothing;

    update public.couriers set availability = 'online' where id = v_delivery.courier_id;
  end if;

  return v_delivery;
end;
$$;

revoke all on function public.post_order_ledger(uuid, text) from public, anon, authenticated;
revoke all on function public.confirm_payment(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_payment(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.record_refund(text, text, numeric, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.expire_unpaid_orders() from public, anon, authenticated;

revoke all on function public.courier_advance_delivery(uuid, public.delivery_status) from public, anon;
grant execute on function public.courier_advance_delivery(uuid, public.delivery_status) to authenticated;
