\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.assert(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if not p_condition then
    raise exception 'FAIL: %', p_label;
  end if;
  raise notice 'pass: %', p_label;
end;
$$;

create or replace function pg_temp.act_as(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated', 'is_anonymous', false)::text, true);
end;
$$;

create or replace function pg_temp.act_as_system()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create temporary table t_sup (key text primary key, id uuid not null) on commit drop;
grant all on t_sup to anon, authenticated;

insert into auth.users (id, email) values
  (gen_random_uuid(), 'sup-customer@test.local'),
  (gen_random_uuid(), 'sup-other@test.local'),
  (gen_random_uuid(), 'sup-admin@test.local'),
  (gen_random_uuid(), 'sup-admin2@test.local'),
  (gen_random_uuid(), 'sup-merchant@test.local'),
  (gen_random_uuid(), 'sup-courier@test.local');

insert into t_sup (key, id)
select 'customer', id from auth.users where email = 'sup-customer@test.local'
union all select 'other', id from auth.users where email = 'sup-other@test.local'
union all select 'admin', id from auth.users where email = 'sup-admin@test.local'
union all select 'admin2', id from auth.users where email = 'sup-admin2@test.local'
union all select 'merchant', id from auth.users where email = 'sup-merchant@test.local'
union all select 'courier', id from auth.users where email = 'sup-courier@test.local';

update public.profiles set role = 'admin'
 where id in ((select id from t_sup where key = 'admin'), (select id from t_sup where key = 'admin2'));
update public.profiles set full_name = 'Ada Customer'
 where id = (select id from t_sup where key = 'customer');

insert into public.couriers (id, full_name, verification_status, availability)
select id, 'Sup Courier', 'approved', 'online' from t_sup where key = 'courier';

update public.platform_settings set card_payments_enabled = true;

insert into public.restaurants (name, min_order, is_open, latitude, longitude)
values ('Support Kitchen', 0, true, 51.9625, 7.6257);
insert into t_sup (key, id) select 'restaurant', id from public.restaurants where name = 'Support Kitchen';

insert into public.restaurant_members (restaurant_id, user_id, role)
select r.id, m.id, 'owner' from t_sup r, t_sup m where r.key = 'restaurant' and m.key = 'merchant';

insert into public.menu_categories (restaurant_id, name)
select id, 'Mains' from t_sup where key = 'restaurant';

insert into public.dishes (restaurant_id, menu_category_id, name, price, is_available)
select r.id, m.id, 'Support Dish', 10.00, true
  from t_sup r join public.menu_categories m on m.restaurant_id = r.id
 where r.key = 'restaurant';
insert into t_sup (key, id) select 'dish', id from public.dishes where name = 'Support Dish';

insert into public.addresses (user_id, label, address_line, latitude, longitude)
select id, 'Home', 'Supportweg 1', 51.9650, 7.6300 from t_sup where key = 'customer';
insert into t_sup (key, id) select 'address', id from public.addresses where address_line = 'Supportweg 1';

insert into public.addresses (user_id, label, address_line, latitude, longitude)
select id, 'Home', 'Supportweg 2', 51.9650, 7.6300 from t_sup where key = 'other';
insert into t_sup (key, id) select 'address_other', id from public.addresses where address_line = 'Supportweg 2';

create or replace function pg_temp.place_order(p_user text, p_address text, p_method text)
returns uuid language plpgsql as $$
declare v_order public.orders;
begin
  perform pg_temp.act_as((select id from t_sup where key = p_user));
  v_order := public.create_order(
    (select id from t_sup where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object(
      'dish_id', (select id from t_sup where key = 'dish'), 'quantity', 3, 'addon_ids', '[]'::jsonb)),
    'delivery', (select id from t_sup where key = p_address), null, 0, p_method, false, false,
    gen_random_uuid(), null);
  return v_order.id;
end;
$$;

create or replace function pg_temp.deliver(p_order_id uuid)
returns void language plpgsql as $$
begin
  perform pg_temp.act_as((select id from t_sup where key = 'admin'));
  perform public.transition_order_status(p_order_id, 'accepted'::public.order_status);
  perform public.transition_order_status(p_order_id, 'preparing'::public.order_status);
  perform public.transition_order_status(p_order_id, 'ready_for_pickup'::public.order_status);
  perform public.transition_order_status(p_order_id, 'delivered'::public.order_status);
end;
$$;

do $$
declare v_order_id uuid; v_payment public.payments;
begin
  v_order_id := pg_temp.place_order('customer', 'address', 'card');
  insert into t_sup (key, id) values ('order', v_order_id);

  update public.payments set provider_intent_id = 'pi_support' where order_id = v_order_id;
  perform pg_temp.act_as_system();
  perform public.confirm_payment('pi_support', 'ch_support', 'evt_support', '{}'::jsonb);
  perform pg_temp.deliver(v_order_id);

  insert into t_sup (key, id)
  select 'order_item', id from public.order_items where order_id = v_order_id limit 1;
end;
$$;

do $$
declare v_can boolean; v_reason text;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'customer'));
  select can_report, reason into v_can, v_reason
    from public.support_report_eligibility((select id from t_sup where key = 'order'));
  perform pg_temp.assert(v_can and v_reason = 'eligible', 'a delivered order can be reported');

  perform pg_temp.act_as((select id from t_sup where key = 'other'));
  select can_report, reason into v_can, v_reason
    from public.support_report_eligibility((select id from t_sup where key = 'order'));
  perform pg_temp.assert(not v_can and v_reason = 'not_your_order',
    'another customer cannot report someone else''s order');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'other'));
  begin
    perform public.submit_support_ticket(
      (select id from t_sup where key = 'order'), gen_random_uuid(), 'missing_items', 'not mine');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'reporting another customer order is refused');
end;
$$;

do $$
declare v_ticket public.support_tickets; v_key uuid := gen_random_uuid();
begin
  perform pg_temp.act_as((select id from t_sup where key = 'customer'));
  v_ticket := public.submit_support_ticket(
    (select id from t_sup where key = 'order'), v_key, 'missing_items', '  One dish was missing  ',
    jsonb_build_array(jsonb_build_object(
      'order_item_id', (select id from t_sup where key = 'order_item'), 'quantity', 1)));

  perform pg_temp.assert(v_ticket.status = 'open', 'a new ticket starts open');
  perform pg_temp.assert(v_ticket.description = 'One dish was missing', 'the description is trimmed');
  perform pg_temp.assert(v_ticket.category = 'missing_items', 'the category is stored');
  insert into t_sup (key, id) values ('ticket', v_ticket.id);
  insert into t_sup (key, id) values ('ticket_key', v_key);

  perform pg_temp.assert(
    (select count(*) from public.support_ticket_items where ticket_id = v_ticket.id) = 1,
    'the reported item is recorded');
  perform pg_temp.assert(
    (select count(*) from public.support_messages where ticket_id = v_ticket.id) = 1,
    'the description opens the conversation');
end;
$$;

do $$
declare v_again public.support_tickets; v_count int;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'customer'));
  v_again := public.submit_support_ticket(
    (select id from t_sup where key = 'order'),
    (select id from t_sup where key = 'ticket_key'),
    'missing_items', 'One dish was missing');

  perform pg_temp.assert(v_again.id = (select id from t_sup where key = 'ticket'),
    'resubmitting the same report id returns the original ticket');

  select count(*) into v_count from public.support_tickets
   where order_id = (select id from t_sup where key = 'order');
  perform pg_temp.assert(v_count = 1, 'a duplicate submission never creates a second ticket');
end;
$$;

do $$
declare v_failed boolean := false; v_can boolean; v_reason text;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'customer'));

  select can_report, reason into v_can, v_reason
    from public.support_report_eligibility((select id from t_sup where key = 'order'));
  perform pg_temp.assert(not v_can and v_reason = 'already_open',
    'a second report is blocked while one is open');

  begin
    perform public.submit_support_ticket(
      (select id from t_sup where key = 'order'), gen_random_uuid(), 'other', 'another problem');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a concurrent second ticket for the same order is refused');
end;
$$;

do $$
declare v_other_order uuid; v_failed boolean; v_other_item uuid;
begin
  v_other_order := pg_temp.place_order('other', 'address_other', 'cash');
  perform pg_temp.deliver(v_other_order);
  select id into v_other_item from public.order_items where order_id = v_other_order limit 1;
  insert into t_sup (key, id) values ('cash_order', v_other_order);

  perform pg_temp.act_as((select id from t_sup where key = 'other'));

  v_failed := false;
  begin
    perform public.submit_support_ticket(
      v_other_order, gen_random_uuid(), 'missing_items', 'cross order item',
      jsonb_build_array(jsonb_build_object(
        'order_item_id', (select id from t_sup where key = 'order_item'), 'quantity', 1)));
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'an item from another order is refused');

  v_failed := false;
  begin
    perform public.submit_support_ticket(
      v_other_order, gen_random_uuid(), 'missing_items', 'too many',
      jsonb_build_array(jsonb_build_object('order_item_id', v_other_item, 'quantity', 99)));
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a quantity above what was ordered is refused');

  v_failed := false;
  begin
    perform public.submit_support_ticket(
      v_other_order, gen_random_uuid(), 'missing_items', 'zero',
      jsonb_build_array(jsonb_build_object('order_item_id', v_other_item, 'quantity', 0)));
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a zero quantity is refused');

  perform pg_temp.assert(
    (select count(*) from public.support_tickets where order_id = v_other_order) = 0,
    'a refused report leaves no ticket behind');
end;
$$;

do $$
declare v_failed boolean;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'other'));

  v_failed := false;
  begin
    perform public.submit_support_ticket(
      (select id from t_sup where key = 'cash_order'), gen_random_uuid(), 'other', '   ');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'an empty description is refused');

  v_failed := false;
  begin
    perform public.submit_support_ticket(
      (select id from t_sup where key = 'cash_order'), gen_random_uuid(), 'hacking', 'bad category');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'an unknown category is refused');

  v_failed := false;
  begin
    perform public.submit_support_ticket(
      (select id from t_sup where key = 'cash_order'), gen_random_uuid(), 'other', repeat('x', 2001));
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'an over long description is refused');
end;
$$;

do $$
declare v_rows int; v_failed boolean := false;
begin
  set local role authenticated;

  perform pg_temp.act_as((select id from t_sup where key = 'other'));
  select count(*) into v_rows from public.support_tickets
   where id = (select id from t_sup where key = 'ticket');
  perform pg_temp.assert(v_rows = 0, 'another customer cannot read the ticket');

  select count(*) into v_rows from public.support_messages
   where ticket_id = (select id from t_sup where key = 'ticket');
  perform pg_temp.assert(v_rows = 0, 'another customer cannot read the conversation');

  perform pg_temp.act_as((select id from t_sup where key = 'merchant'));
  select count(*) into v_rows from public.support_messages
   where ticket_id = (select id from t_sup where key = 'ticket');
  perform pg_temp.assert(v_rows = 0, 'the restaurant cannot read a support conversation');

  perform pg_temp.act_as((select id from t_sup where key = 'courier'));
  select count(*) into v_rows from public.support_messages
   where ticket_id = (select id from t_sup where key = 'ticket');
  perform pg_temp.assert(v_rows = 0, 'the courier cannot read a support conversation');

  reset role;

  perform pg_temp.act_as((select id from t_sup where key = 'merchant'));
  begin
    perform public.support_messages_page((select id from t_sup where key = 'ticket'), null, null, 30);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'the restaurant cannot page a support conversation');
end;
$$;

do $$
declare v_rows int;
begin
  set local role anon;
  perform set_config('request.jwt.claims', '', true);

  begin
    select count(*) into v_rows from public.support_tickets;
    perform pg_temp.assert(v_rows = 0, 'anonymous visitors read no tickets');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'anonymous visitors hold no grant on tickets');
  end;

  reset role;
end;
$$;

do $$
declare v_message public.support_messages; v_key uuid := gen_random_uuid(); v_count int;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'admin'));
  v_message := public.send_support_message(
    (select id from t_sup where key = 'ticket'), v_key, 'We are looking into this');
  perform pg_temp.assert(v_message.sender_role = 'admin', 'the server sets the admin sender role');
  perform pg_temp.assert(
    v_message.sender_id = (select id from t_sup where key = 'admin'),
    'the sender comes from the session, never the client');

  v_message := public.send_support_message(
    (select id from t_sup where key = 'ticket'), v_key, 'We are looking into this');
  select count(*) into v_count from public.support_messages
   where ticket_id = (select id from t_sup where key = 'ticket') and client_message_id = v_key;
  perform pg_temp.assert(v_count = 1, 'resending the same message id stores one message');

  perform pg_temp.assert(
    (select count(*) from public.notifications
      where kind = 'support_message'
        and user_id = (select id from t_sup where key = 'customer')) = 1,
    'an admin reply notifies the customer exactly once');

  perform pg_temp.assert(
    (select body from public.notifications where kind = 'support_message' limit 1)
      not like '%looking into this%',
    'the notification never repeats the message text');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'other'));
  begin
    perform public.send_support_message(
      (select id from t_sup where key = 'ticket'), gen_random_uuid(), 'let me in');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'an unrelated customer cannot write in the ticket');
end;
$$;

do $$
declare v_rows int; v_total int := 0; v_cursor timestamptz; v_cursor_id uuid; v_row record;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'customer'));

  insert into public.support_messages (ticket_id, client_message_id, sender_id, sender_role, body, created_at)
  select (select id from t_sup where key = 'ticket'), gen_random_uuid(),
         (select id from t_sup where key = 'customer'), 'customer',
         'same instant ' || g, '2026-02-01T10:00:00Z'::timestamptz
    from generate_series(1, 4) g;

  for v_row in
    select * from public.support_messages_page(
      (select id from t_sup where key = 'ticket'), null, null, 3)
  loop
    v_cursor := v_row.created_at;
    v_cursor_id := v_row.id;
    v_total := v_total + 1;
  end loop;
  perform pg_temp.assert(v_total = 3, 'the conversation is paginated');

  for v_row in
    select * from public.support_messages_page(
      (select id from t_sup where key = 'ticket'), v_cursor, v_cursor_id, 30)
  loop
    v_total := v_total + 1;
  end loop;
  perform pg_temp.assert(v_total = 6, 'keyset paging walks identical timestamps exactly once');
end;
$$;

do $$
declare v_ticket public.support_tickets; v_failed boolean := false;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'customer'));
  begin
    perform public.admin_assign_support_ticket(
      (select id from t_sup where key = 'ticket'), (select id from t_sup where key = 'customer'), null);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a customer cannot assign a ticket');

  perform pg_temp.act_as((select id from t_sup where key = 'admin'));

  v_failed := false;
  begin
    perform public.admin_assign_support_ticket(
      (select id from t_sup where key = 'ticket'), (select id from t_sup where key = 'customer'), null);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a ticket can only be assigned to an administrator');

  select * into v_ticket from public.support_tickets where id = (select id from t_sup where key = 'ticket');
  v_ticket := public.admin_assign_support_ticket(
    v_ticket.id, (select id from t_sup where key = 'admin'), v_ticket.revision);
  perform pg_temp.assert(v_ticket.assigned_admin_id = (select id from t_sup where key = 'admin'),
    'an admin can take a ticket');
  perform pg_temp.assert(v_ticket.status = 'in_review', 'taking an open ticket moves it to in review');

  perform pg_temp.assert(
    (select count(*) from public.admin_actions
      where action = 'assign_support_ticket'
        and subject_id = (select id::text from t_sup where key = 'ticket')) = 1,
    'assignment is written to the audit log');
end;
$$;

do $$
declare v_ticket public.support_tickets; v_failed boolean := false; v_stale int;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'admin2'));
  select revision into v_stale from public.support_tickets
   where id = (select id from t_sup where key = 'ticket');

  v_ticket := public.admin_assign_support_ticket(
    (select id from t_sup where key = 'ticket'),
    (select id from t_sup where key = 'admin2'), v_stale);
  perform pg_temp.assert(v_ticket.assigned_admin_id = (select id from t_sup where key = 'admin2'),
    'a second admin can take over with the current revision');

  begin
    perform public.admin_assign_support_ticket(
      (select id from t_sup where key = 'ticket'),
      (select id from t_sup where key = 'admin'), v_stale);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a stale revision cannot silently overwrite an assignment');
end;
$$;

do $$
declare v_summary record;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'admin'));
  select * into v_summary from public.order_refund_summary((select id from t_sup where key = 'order'));

  perform pg_temp.assert(v_summary.method = 'card', 'a card order reports the card method');
  perform pg_temp.assert(v_summary.confirmed_refunds = 0, 'nothing is refunded yet');
  perform pg_temp.assert(v_summary.reserved_refunds = 0, 'nothing is reserved yet');
  perform pg_temp.assert(
    v_summary.remaining_refundable = v_summary.charged,
    'the whole charge is refundable at first');
end;
$$;

do $$
declare v_failed boolean; v_charged numeric;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'customer'));
  v_failed := false;
  begin
    perform public.admin_approve_support_refund(
      (select id from t_sup where key = 'ticket'), 5.00, 'give me money');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a customer cannot approve a refund');

  perform pg_temp.act_as((select id from t_sup where key = 'merchant'));
  v_failed := false;
  begin
    perform public.admin_approve_support_refund(
      (select id from t_sup where key = 'ticket'), 5.00, 'merchant refund');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a merchant cannot approve a refund');

  perform pg_temp.act_as((select id from t_sup where key = 'admin'));

  v_failed := false;
  begin
    perform public.admin_approve_support_refund(
      (select id from t_sup where key = 'ticket'), 5.00, '   ');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a refund without a reason is refused');

  v_failed := false;
  begin
    perform public.admin_approve_support_refund(
      (select id from t_sup where key = 'ticket'), 0, 'zero');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a zero refund is refused');

  v_failed := false;
  begin
    perform public.admin_approve_support_refund(
      (select id from t_sup where key = 'ticket'), -5, 'negative');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a negative refund is refused');

  select charged into v_charged from public.order_refund_summary((select id from t_sup where key = 'order'));
  v_failed := false;
  begin
    perform public.admin_approve_support_refund(
      (select id from t_sup where key = 'ticket'), v_charged + 1, 'too much');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a refund above the charge is refused');
end;
$$;

do $$
declare v_refund public.support_refunds; v_summary record; v_recon public.payment_reconciliations;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'admin'));
  v_refund := public.admin_approve_support_refund(
    (select id from t_sup where key = 'ticket'), 10.00, 'one dish missing');
  insert into t_sup (key, id) values ('refund1', v_refund.id);

  perform pg_temp.assert(v_refund.state = 'reserved', 'an approved refund starts reserved');
  perform pg_temp.assert(v_refund.method = 'card', 'a card order refunds through the provider');
  perform pg_temp.assert(v_refund.reconciliation_id is not null,
    'a card refund is queued for the worker');

  select * into v_recon from public.payment_reconciliations where id = v_refund.reconciliation_id;
  perform pg_temp.assert(v_recon.kind = 'support_refund', 'the queue entry is a support refund');
  perform pg_temp.assert(v_recon.provider_idempotency_key = v_refund.provider_idempotency_key,
    'the refund carries its own provider idempotency key');

  select * into v_summary from public.order_refund_summary((select id from t_sup where key = 'order'));
  perform pg_temp.assert(v_summary.reserved_refunds = 10.00, 'the reservation is counted');
  perform pg_temp.assert(
    v_summary.remaining_refundable = v_summary.charged - 10.00,
    'a reservation reduces what is still refundable');
end;
$$;

do $$
declare v_refund2 public.support_refunds; v_key1 uuid; v_key2 uuid;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'admin'));
  v_refund2 := public.admin_approve_support_refund(
    (select id from t_sup where key = 'ticket'), 5.00, 'second partial');
  insert into t_sup (key, id) values ('refund2', v_refund2.id);

  select provider_idempotency_key into v_key1 from public.support_refunds
   where id = (select id from t_sup where key = 'refund1');
  select provider_idempotency_key into v_key2 from public.support_refunds
   where id = (select id from t_sup where key = 'refund2');

  perform pg_temp.assert(v_key1 <> v_key2,
    'each partial refund gets its own provider idempotency key');

  perform pg_temp.assert(
    (select reserved_refunds from public.order_refund_summary(
      (select id from t_sup where key = 'order'))) = 15.00,
    'both reservations are counted together');
end;
$$;

do $$
declare v_first public.support_refunds; v_second public.support_refunds; v_key uuid := gen_random_uuid();
begin
  perform pg_temp.act_as((select id from t_sup where key = 'admin'));

  v_first := public.admin_approve_support_refund(
    (select id from t_sup where key = 'ticket'), 2.00, 'double tap', 'platform', v_key);
  v_second := public.admin_approve_support_refund(
    (select id from t_sup where key = 'ticket'), 2.00, 'double tap', 'platform', v_key);

  perform pg_temp.assert(v_first.id = v_second.id,
    'approving twice with the same request id refunds once');
  perform pg_temp.assert(
    (select count(*) from public.support_refunds
      where ticket_id = (select id from t_sup where key = 'ticket')
        and client_request_id = v_key) = 1,
    'a repeated approval stores a single refund');
  perform pg_temp.assert(
    (select count(*) from public.payment_reconciliations
      where provider_idempotency_key = v_first.provider_idempotency_key) = 1,
    'a repeated approval queues a single provider call');

  perform public.settle_support_refund(v_first.id, 'cancelled', null);
end;
$$;

do $$
declare v_failed boolean := false; v_remaining numeric;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'admin'));
  select remaining_refundable into v_remaining
    from public.order_refund_summary((select id from t_sup where key = 'order'));

  begin
    perform public.admin_approve_support_refund(
      (select id from t_sup where key = 'ticket'), v_remaining + 0.01, 'one cent too far');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed,
    'reservations plus a new refund can never exceed the remaining charge');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'admin'));
  begin
    perform public.admin_set_support_status(
      (select id from t_sup where key = 'ticket'), 'resolved',
      (select revision from public.support_tickets where id = (select id from t_sup where key = 'ticket')));
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed,
    'a ticket is not resolved while an approved refund has not settled');
end;
$$;

do $$
declare v_refund public.support_refunds; v_payment public.payments; v_summary record;
begin
  perform pg_temp.act_as_system();

  perform public.resolve_payment_reconciliation(
    (select reconciliation_id from public.support_refunds
      where id = (select id from t_sup where key = 'refund1')),
    're_support_1', 'evt_support_refund_1', '{}'::jsonb);

  select * into v_refund from public.support_refunds where id = (select id from t_sup where key = 'refund1');
  perform pg_temp.assert(v_refund.state = 'confirmed',
    'the worker settling the reconciliation confirms the support refund');
  perform pg_temp.assert(v_refund.settled_at is not null, 'the settlement time is recorded');

  select * into v_payment from public.payments where order_id = (select id from t_sup where key = 'order');
  perform pg_temp.assert(v_payment.amount_refunded = 10.00,
    'the confirmed refund is counted against the payment');

  perform pg_temp.act_as((select id from t_sup where key = 'admin'));
  select * into v_summary from public.order_refund_summary((select id from t_sup where key = 'order'));
  perform pg_temp.assert(v_summary.confirmed_refunds = 10.00, 'the summary shows the confirmed refund');
  perform pg_temp.assert(v_summary.reserved_refunds = 5.00, 'only the open reservation stays reserved');
  perform pg_temp.assert(
    v_summary.remaining_refundable = v_summary.charged - 15.00,
    'the remaining balance accounts for confirmed and reserved amounts');
end;
$$;

do $$
declare v_refund_total numeric; v_payout numeric;
begin
  select coalesce(sum(amount), 0) into v_refund_total from public.ledger_entries
   where order_id = (select id from t_sup where key = 'order') and entry_type = 'refund';
  perform pg_temp.assert(v_refund_total = -10.00,
    'only a confirmed provider refund writes a refund ledger entry');

  select coalesce(sum(amount), 0) into v_payout from public.ledger_entries
   where order_id = (select id from t_sup where key = 'order') and entry_type = 'restaurant_payout';
  perform pg_temp.assert(v_payout < 0,
    'a platform funded refund leaves the restaurant payout untouched');
end;
$$;

do $$
declare v_refund public.support_refunds; v_payout_before numeric; v_payout_after numeric;
begin
  select coalesce(sum(amount), 0) into v_payout_before from public.ledger_entries
   where order_id = (select id from t_sup where key = 'order') and entry_type = 'restaurant_payout';

  perform pg_temp.act_as((select id from t_sup where key = 'admin'));
  v_refund := public.admin_approve_support_refund(
    (select id from t_sup where key = 'ticket'), 3.00, 'restaurant fault', 'restaurant');

  perform pg_temp.act_as_system();
  perform public.resolve_payment_reconciliation(
    v_refund.reconciliation_id, 're_support_rest', 'evt_support_rest', '{}'::jsonb);

  perform pg_temp.assert(
    (select state from public.support_refunds where id = v_refund.id) = 'confirmed',
    'a second partial refund on the same order also confirms');

  select coalesce(sum(amount), 0) into v_payout_after from public.ledger_entries
   where order_id = (select id from t_sup where key = 'order') and entry_type = 'restaurant_payout';

  perform pg_temp.assert(v_payout_after = v_payout_before + 3.00,
    'a restaurant funded refund claws the amount back from the payout');
end;
$$;

do $$
declare v_refund public.support_refunds; v_reserved numeric;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'admin'));
  v_refund := public.admin_approve_support_refund(
    (select id from t_sup where key = 'ticket'), 1.00, 'will fail');
  insert into t_sup (key, id) values ('refund_failed', v_refund.id);

  perform pg_temp.act_as_system();
  perform public.fail_payment_reconciliation(
    v_refund.reconciliation_id, 'Stripe rejected the refund');

  perform pg_temp.assert(
    (select state from public.support_refunds where id = v_refund.id) = 'reserved',
    'a retryable provider failure keeps the refund reserved');

  update public.payment_reconciliations set attempts = 10 where id = v_refund.reconciliation_id;
  perform public.fail_payment_reconciliation(
    v_refund.reconciliation_id, 'Authorization: Bearer sk_live_leak was rejected');

  perform pg_temp.assert(
    (select state from public.payment_reconciliations where id = v_refund.reconciliation_id)
      = 'abandoned',
    'a repeatedly failing refund is abandoned');
  perform pg_temp.assert(
    (select state from public.support_refunds where id = v_refund.id) = 'failed',
    'abandoning the job fails the support refund');
  perform pg_temp.assert(
    (select failure_reason from public.support_refunds where id = v_refund.id)
      not like '%sk_live_leak%',
    'the failure reason is sanitised');

  perform pg_temp.act_as((select id from t_sup where key = 'admin'));
  select reserved_refunds into v_reserved
    from public.order_refund_summary((select id from t_sup where key = 'order'));
  perform pg_temp.assert(v_reserved = 5.00,
    'a failed refund releases its reservation back to the balance');
end;
$$;

do $$
declare v_recon_id uuid; v_reserved numeric; v_failed boolean := false; v_filler uuid;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'admin'));
  select reconciliation_id into v_recon_id from public.support_refunds
   where id = (select id from t_sup where key = 'refund_failed');

  perform public.admin_retry_payment_reconciliation(v_recon_id, 'the card network recovered');

  perform pg_temp.assert(
    (select state from public.support_refunds
      where id = (select id from t_sup where key = 'refund_failed')) = 'reserved',
    'retrying an abandoned refund reserves the amount again');

  select reserved_refunds into v_reserved
    from public.order_refund_summary((select id from t_sup where key = 'order'));
  perform pg_temp.assert(v_reserved = 6.00, 'the revived reservation is counted again');

  perform pg_temp.act_as_system();
  update public.payment_reconciliations set attempts = 10 where id = v_recon_id;
  perform public.fail_payment_reconciliation(v_recon_id, 'gone for good');

  perform pg_temp.act_as((select id from t_sup where key = 'admin'));
  v_filler := (public.admin_approve_support_refund(
    (select id from t_sup where key = 'ticket'),
    (select remaining_refundable from public.order_refund_summary(
      (select id from t_sup where key = 'order'))),
    'spend the rest of the balance')).id;

  begin
    perform public.admin_retry_payment_reconciliation(v_recon_id, 'try once more');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed,
    'a retry is refused once the order can no longer cover the refund');

  perform public.settle_support_refund(v_filler, 'cancelled', null);
  perform pg_temp.assert(
    (select reserved_refunds from public.order_refund_summary(
      (select id from t_sup where key = 'order'))) = 5.00,
    'cancelling a refund returns its reservation to the balance');
end;
$$;

do $$
declare v_ticket public.support_tickets; v_cash_ticket public.support_tickets; v_refund public.support_refunds;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'other'));
  v_cash_ticket := public.submit_support_ticket(
    (select id from t_sup where key = 'cash_order'), gen_random_uuid(), 'late_delivery',
    'It arrived very late');
  insert into t_sup (key, id) values ('cash_ticket', v_cash_ticket.id);

  perform pg_temp.act_as((select id from t_sup where key = 'admin'));
  v_refund := public.admin_approve_support_refund(v_cash_ticket.id, 4.00, 'late delivery goodwill');
  insert into t_sup (key, id) values ('cash_refund', v_refund.id);

  perform pg_temp.assert(v_refund.method = 'cash', 'a cash order refunds by hand');
  perform pg_temp.assert(v_refund.reconciliation_id is null,
    'a cash refund is never queued for the card worker');
  perform pg_temp.assert(v_refund.state = 'reserved', 'a cash refund waits for confirmation');
end;
$$;

do $$
declare v_failed boolean := false; v_refund public.support_refunds; v_ledger numeric;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'customer'));
  begin
    perform public.admin_confirm_cash_refund((select id from t_sup where key = 'cash_refund'), 'paid');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a customer cannot confirm a cash refund');

  perform pg_temp.act_as((select id from t_sup where key = 'admin'));

  v_failed := false;
  begin
    perform public.admin_confirm_cash_refund((select id from t_sup where key = 'cash_refund'), '  ');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'confirming cash needs a settlement note');

  v_failed := false;
  begin
    perform public.admin_confirm_cash_refund((select id from t_sup where key = 'refund2'), 'wrong method');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a card refund cannot be settled by hand');

  v_refund := public.admin_confirm_cash_refund(
    (select id from t_sup where key = 'cash_refund'), 'returned in cash at the door');
  perform pg_temp.assert(v_refund.state = 'confirmed', 'an admin confirms the external cash settlement');

  select coalesce(sum(amount), 0) into v_ledger from public.ledger_entries
   where order_id = (select id from t_sup where key = 'cash_order') and entry_type = 'refund';
  perform pg_temp.assert(v_ledger = -4.00, 'a confirmed cash refund writes the refund ledger entry');

  perform pg_temp.assert(
    (select count(*) from public.admin_actions
      where action = 'confirm_cash_refund'
        and subject_id = (select id::text from t_sup where key = 'cash_refund')) = 1,
    'the cash settlement is audited');

  v_refund := public.admin_confirm_cash_refund(
    (select id from t_sup where key = 'cash_refund'), 'again');
  select coalesce(sum(amount), 0) into v_ledger from public.ledger_entries
   where order_id = (select id from t_sup where key = 'cash_order') and entry_type = 'refund';
  perform pg_temp.assert(v_ledger = -4.00, 'confirming cash twice never refunds twice');
end;
$$;

do $$
declare v_ticket public.support_tickets; v_revision int;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'admin'));
  perform public.settle_support_refund((select id from t_sup where key = 'refund2'), 'cancelled', null);

  select revision into v_revision from public.support_tickets
   where id = (select id from t_sup where key = 'ticket');
  v_ticket := public.admin_set_support_status(
    (select id from t_sup where key = 'ticket'), 'resolved', v_revision, 'refunded the missing dish');

  perform pg_temp.assert(v_ticket.status = 'resolved', 'a ticket resolves once refunds settled');
  perform pg_temp.assert(v_ticket.resolved_at is not null, 'the resolution time is recorded');
  perform pg_temp.assert(
    (select count(*) from public.notifications
      where kind = 'support_status'
        and data ->> 'ticket_id' = (select id::text from t_sup where key = 'ticket')) >= 1,
    'the customer is told the ticket was resolved');
end;
$$;

do $$
declare v_ticket public.support_tickets;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'customer'));
  perform public.send_support_message(
    (select id from t_sup where key = 'ticket'), gen_random_uuid(), 'It happened again');

  select * into v_ticket from public.support_tickets where id = (select id from t_sup where key = 'ticket');
  perform pg_temp.assert(v_ticket.status = 'open', 'a customer reply reopens a resolved ticket');
  perform pg_temp.assert(v_ticket.reopened_count = 1, 'the reopen is counted');
  perform pg_temp.assert(v_ticket.resolved_at is null, 'reopening clears the resolution time');
end;
$$;

do $$
declare v_authorised boolean;
begin
  v_authorised := public.notification_recipient_still_authorised(
    'support_message',
    (select id from t_sup where key = 'customer'),
    (select id from t_sup where key = 'order'));
  perform pg_temp.assert(v_authorised, 'the ticket owner stays a valid push recipient');

  v_authorised := public.notification_recipient_still_authorised(
    'support_message',
    (select id from t_sup where key = 'other'),
    (select id from t_sup where key = 'order'));
  perform pg_temp.assert(not v_authorised, 'an unrelated customer is never a support push recipient');

  v_authorised := public.notification_recipient_still_authorised(
    'support_refund',
    (select id from t_sup where key = 'courier'),
    (select id from t_sup where key = 'order'));
  perform pg_temp.assert(not v_authorised, 'a courier is never a support refund push recipient');
end;
$$;

do $$
declare v_failed boolean := false; v_rows int;
begin
  set local role authenticated;
  perform pg_temp.act_as((select id from t_sup where key = 'customer'));

  begin
    insert into public.support_tickets (order_id, user_id, client_ticket_id, category, description)
    values ((select id from t_sup where key = 'order'), (select id from t_sup where key = 'customer'),
            gen_random_uuid(), 'other', 'forged');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a client cannot insert a ticket directly');

  v_failed := false;
  begin
    update public.support_tickets set status = 'resolved'
     where id = (select id from t_sup where key = 'ticket');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a client cannot change ticket status directly');

  v_failed := false;
  begin
    insert into public.support_refunds (ticket_id, order_id, method, amount, reason)
    values ((select id from t_sup where key = 'ticket'), (select id from t_sup where key = 'order'),
            'cash', 999, 'forged');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a client cannot forge a refund');

  v_failed := false;
  begin
    update public.support_refunds set state = 'confirmed'
     where id = (select id from t_sup where key = 'refund2');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a client cannot confirm a refund directly');

  v_failed := false;
  begin
    insert into public.admin_actions (admin_id, action, subject_type, subject_id)
    values ((select id from t_sup where key = 'customer'), 'forged', 'support_ticket', 'x');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a client cannot write the audit log');

  reset role;
end;
$$;

do $$
declare v_rows int;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'admin'));
  select count(*) into v_rows from public.admin_support_tickets(null, null, null, 20, 0);
  perform pg_temp.assert(v_rows >= 2, 'an admin sees the ticket queue');

  select count(*) into v_rows from public.admin_support_tickets('open', null, null, 20, 0);
  perform pg_temp.assert(v_rows >= 1, 'the queue filters by status');

  select count(*) into v_rows from public.admin_support_tickets(null, 'late_delivery', null, 20, 0);
  perform pg_temp.assert(v_rows = 1, 'the queue filters by category');

  select count(*) into v_rows from public.admin_support_tickets(null, null, 'unassigned', 20, 0);
  perform pg_temp.assert(v_rows >= 1, 'the queue can show only unassigned tickets');

  perform pg_temp.act_as((select id from t_sup where key = 'customer'));
  select count(*) into v_rows from public.admin_support_tickets(null, null, null, 20, 0);
  perform pg_temp.assert(v_rows = 0, 'a customer sees nothing in the admin queue');
end;
$$;

do $$
declare v_rows int;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'customer'));
  select count(*) into v_rows from public.my_support_tickets(20, 0);
  perform pg_temp.assert(v_rows = 1, 'a customer sees only their own tickets');

  perform pg_temp.act_as((select id from t_sup where key = 'other'));
  select count(*) into v_rows from public.my_support_tickets(20, 0);
  perform pg_temp.assert(v_rows = 1, 'the other customer sees only their own ticket');
end;
$$;

do $$
declare v_unread int;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'customer'));

  select unread_count into v_unread from public.my_support_tickets(20, 0)
   where id = (select id from t_sup where key = 'ticket');
  perform pg_temp.assert(v_unread > 0, 'admin replies the customer has not seen are unread');

  perform public.mark_support_messages_read((select id from t_sup where key = 'ticket'));

  select unread_count into v_unread from public.my_support_tickets(20, 0)
   where id = (select id from t_sup where key = 'ticket');
  perform pg_temp.assert(v_unread = 0, 'reading the ticket clears the unread badge');

  perform pg_temp.assert(
    public.support_unread_count((select id from t_sup where key = 'ticket')) = 0,
    'the unread count agrees with the ticket list');
end;
$$;

do $$
declare v_before int; v_after int;
begin
  update public.support_message_reads
     set last_read_at = last_read_at - interval '1 minute'
   where ticket_id = (select id from t_sup where key = 'ticket');

  perform pg_temp.act_as((select id from t_sup where key = 'customer'));
  select unread_count into v_before from public.my_support_tickets(20, 0)
   where id = (select id from t_sup where key = 'ticket');

  perform pg_temp.act_as((select id from t_sup where key = 'admin'));
  perform public.send_support_message(
    (select id from t_sup where key = 'ticket'), gen_random_uuid(), 'One more thing');

  perform pg_temp.act_as((select id from t_sup where key = 'customer'));
  select unread_count into v_after from public.my_support_tickets(20, 0)
   where id = (select id from t_sup where key = 'ticket');
  perform pg_temp.assert(v_after = v_before + 1, 'a later admin reply becomes unread again');

  perform public.send_support_message(
    (select id from t_sup where key = 'ticket'), gen_random_uuid(), 'Thanks');
  select unread_count into v_before from public.my_support_tickets(20, 0)
   where id = (select id from t_sup where key = 'ticket');
  perform pg_temp.assert(v_before = v_after, 'the customer own message is never unread to them');

  perform public.mark_support_messages_read((select id from t_sup where key = 'ticket'));
  select unread_count into v_after from public.my_support_tickets(20, 0)
   where id = (select id from t_sup where key = 'ticket');
  perform pg_temp.assert(v_after = 0, 'reading again clears the badge a second time');
end;
$$;

do $$
declare v_failed boolean := false; v_rows int;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'other'));
  begin
    perform public.mark_support_messages_read((select id from t_sup where key = 'ticket'));
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'another customer cannot mark the ticket read');

  perform pg_temp.assert(
    public.support_unread_count((select id from t_sup where key = 'ticket')) = 0,
    'another customer reads no unread count for the ticket');

  set local role authenticated;
  perform pg_temp.act_as((select id from t_sup where key = 'other'));
  select count(*) into v_rows from public.support_message_reads
   where ticket_id = (select id from t_sup where key = 'ticket');
  perform pg_temp.assert(v_rows = 0, 'read markers are private to their owner');

  v_failed := false;
  begin
    insert into public.support_message_reads (ticket_id, user_id)
    values ((select id from t_sup where key = 'ticket'),
            (select id from t_sup where key = 'other'));
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a client cannot forge a read marker');

  reset role;
end;
$$;

do $$
declare v_read_at timestamptz; v_notifications int;
begin
  perform pg_temp.act_as((select id from t_sup where key = 'customer'));
  perform public.mark_support_messages_read((select id from t_sup where key = 'ticket'));

  select count(*) into v_notifications from public.notifications
   where user_id = (select id from t_sup where key = 'customer')
     and kind in ('support_message', 'support_status', 'support_refund')
     and data ->> 'ticket_id' = (select id::text from t_sup where key = 'ticket')
     and read_at is null;
  perform pg_temp.assert(v_notifications = 0,
    'opening the ticket clears its support notifications');

  perform pg_temp.assert(
    (select count(*) from public.notifications
      where user_id = (select id from t_sup where key = 'customer')
        and kind in ('support_message', 'support_status', 'support_refund')) > 0,
    'the notifications are marked read rather than deleted');
end;
$$;

do $$
declare v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array['support_messages', 'support_tickets', 'support_refunds']
    loop
      perform pg_temp.assert(
        exists (
          select 1 from pg_publication_tables
           where pubname = 'supabase_realtime'
             and schemaname = 'public'
             and tablename = v_table
        ),
        format('%s is published for realtime so the app sees live changes', v_table));
    end loop;
  end if;
end;
$$;

rollback;
