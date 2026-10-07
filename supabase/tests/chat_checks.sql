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

create temporary table t_chat (key text primary key, id uuid not null) on commit drop;
grant all on t_chat to anon, authenticated;

insert into auth.users (id, email) values
  (gen_random_uuid(), 'chat-customer@test.local'),
  (gen_random_uuid(), 'chat-courier-a@test.local'),
  (gen_random_uuid(), 'chat-courier-b@test.local'),
  (gen_random_uuid(), 'chat-stranger@test.local'),
  (gen_random_uuid(), 'chat-merchant@test.local'),
  (gen_random_uuid(), 'chat-admin@test.local');

insert into t_chat (key, id)
select 'customer', id from auth.users where email = 'chat-customer@test.local'
union all select 'courier_a', id from auth.users where email = 'chat-courier-a@test.local'
union all select 'courier_b', id from auth.users where email = 'chat-courier-b@test.local'
union all select 'stranger', id from auth.users where email = 'chat-stranger@test.local'
union all select 'merchant', id from auth.users where email = 'chat-merchant@test.local'
union all select 'admin', id from auth.users where email = 'chat-admin@test.local';

update public.profiles set role = 'admin' where id = (select id from t_chat where key = 'admin');
update public.profiles set full_name = 'Ada Customer'
 where id = (select id from t_chat where key = 'customer');

insert into public.couriers (id, full_name, verification_status, availability)
select id, 'Courier A', 'approved', 'online' from t_chat where key = 'courier_a';
insert into public.couriers (id, full_name, verification_status, availability)
select id, 'Courier B', 'approved', 'online' from t_chat where key = 'courier_b';

insert into public.restaurants (name, min_order, is_open, latitude, longitude)
values ('Chat Kitchen', 0, true, 51.9625, 7.6257);
insert into t_chat (key, id) select 'restaurant', id from public.restaurants where name = 'Chat Kitchen';

insert into public.restaurant_members (restaurant_id, user_id, role)
select r.id, m.id, 'owner' from t_chat r, t_chat m where r.key = 'restaurant' and m.key = 'merchant';

insert into public.menu_categories (restaurant_id, name)
select id, 'Mains' from t_chat where key = 'restaurant';

insert into public.dishes (restaurant_id, menu_category_id, name, price, is_available)
select r.id, m.id, 'Chat Dish', 10.00, true
  from t_chat r join public.menu_categories m on m.restaurant_id = r.id
 where r.key = 'restaurant';
insert into t_chat (key, id) select 'dish', id from public.dishes where name = 'Chat Dish';

insert into public.addresses (user_id, label, address_line, latitude, longitude)
select id, 'Home', 'Chatweg 1', 51.9650, 7.6300 from t_chat where key = 'customer';
insert into t_chat (key, id) select 'address', id from public.addresses where address_line = 'Chatweg 1';

do $$
declare v_order public.orders;
begin
  perform pg_temp.act_as((select id from t_chat where key = 'customer'));
  v_order := public.create_order(
    (select id from t_chat where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object(
      'dish_id', (select id from t_chat where key = 'dish'), 'quantity', 1, 'addon_ids', '[]'::jsonb)),
    'delivery', (select id from t_chat where key = 'address'), null, 0, 'cash', false, false,
    gen_random_uuid(), null);
  insert into t_chat (key, id) values ('order', v_order.id);
end;
$$;

do $$
declare v_delivery public.deliveries;
begin
  select * into v_delivery from public.deliveries
   where order_id = (select id from t_chat where key = 'order');

  if v_delivery.id is null then
    insert into public.deliveries (order_id, restaurant_id, status)
    values ((select id from t_chat where key = 'order'),
            (select id from t_chat where key = 'restaurant'), 'pending')
    returning * into v_delivery;
  end if;

  insert into t_chat (key, id) values ('delivery', v_delivery.id);
end;
$$;

do $$
declare v_can_read boolean; v_can_send boolean; v_reason text;
begin
  perform pg_temp.act_as((select id from t_chat where key = 'customer'));
  select can_read, can_send, reason into v_can_read, v_can_send, v_reason
    from public.order_chat_access((select id from t_chat where key = 'order'));

  perform pg_temp.assert(v_can_read, 'the customer can open the conversation');
  perform pg_temp.assert(not v_can_send, 'nobody can write before a courier is assigned');
  perform pg_temp.assert(v_reason = 'no_courier_yet', 'the unavailable state is explained');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  perform pg_temp.act_as((select id from t_chat where key = 'customer'));
  begin
    perform public.send_order_message(
      (select id from t_chat where key = 'order'), gen_random_uuid(), 'anyone there');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'sending before assignment is refused');
end;
$$;

do $$
begin
  perform pg_temp.act_as_system();
  update public.deliveries
     set courier_id = (select id from t_chat where key = 'courier_a'),
         status = 'assigned', assigned_at = now()
   where id = (select id from t_chat where key = 'delivery');

  perform pg_temp.act_as((select id from t_chat where key = 'admin'));
  perform public.transition_order_status(
    (select id from t_chat where key = 'order'), 'accepted'::public.order_status);
  perform public.transition_order_status(
    (select id from t_chat where key = 'order'), 'preparing'::public.order_status);
  perform public.transition_order_status(
    (select id from t_chat where key = 'order'), 'ready_for_pickup'::public.order_status);
end;
$$;

do $$
declare v_assignments int;
begin
  select count(*) into v_assignments from public.delivery_assignments
   where order_id = (select id from t_chat where key = 'order')
     and courier_id = (select id from t_chat where key = 'courier_a')
     and unassigned_at is null;
  perform pg_temp.assert(v_assignments = 1, 'assigning a courier records assignment history');
end;
$$;

do $$
declare v_role text; v_can_send boolean;
begin
  perform pg_temp.act_as((select id from t_chat where key = 'courier_a'));
  select chat_role, can_send into v_role, v_can_send
    from public.order_chat_access((select id from t_chat where key = 'order'));
  perform pg_temp.assert(v_role = 'courier', 'the assigned courier is recognised');
  perform pg_temp.assert(v_can_send, 'the assigned courier can write while the order is active');

  perform pg_temp.act_as((select id from t_chat where key = 'customer'));
  select can_send into v_can_send
    from public.order_chat_access((select id from t_chat where key = 'order'));
  perform pg_temp.assert(v_can_send, 'the customer can write once a courier is assigned');
end;
$$;

do $$
declare v_message public.order_messages; v_key uuid := gen_random_uuid();
begin
  perform pg_temp.act_as((select id from t_chat where key = 'customer'));
  v_message := public.send_order_message(
    (select id from t_chat where key = 'order'), v_key, '  Please ring the top bell  ');

  perform pg_temp.assert(v_message.body = 'Please ring the top bell', 'the message body is trimmed');
  perform pg_temp.assert(v_message.sender_role = 'customer', 'the server sets the sender role');
  perform pg_temp.assert(
    v_message.sender_id = (select id from t_chat where key = 'customer'),
    'the server sets the sender from the session, not the client');
  insert into t_chat (key, id) values ('first_message', v_message.id);
  insert into t_chat (key, id) values ('first_client_key', v_key);
end;
$$;

do $$
declare v_again public.order_messages; v_count int;
begin
  perform pg_temp.act_as((select id from t_chat where key = 'customer'));
  v_again := public.send_order_message(
    (select id from t_chat where key = 'order'),
    (select id from t_chat where key = 'first_client_key'),
    'Please ring the top bell');

  perform pg_temp.assert(
    v_again.id = (select id from t_chat where key = 'first_message'),
    'retrying with the same client id returns the original message');

  select count(*) into v_count from public.order_messages
   where order_id = (select id from t_chat where key = 'order');
  perform pg_temp.assert(v_count = 1, 'a retry never stores a duplicate message');
end;
$$;

do $$
declare v_failed boolean;
begin
  perform pg_temp.act_as((select id from t_chat where key = 'customer'));

  v_failed := false;
  begin
    perform public.send_order_message(
      (select id from t_chat where key = 'order'), gen_random_uuid(), '    ');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a blank message is refused');

  v_failed := false;
  begin
    perform public.send_order_message(
      (select id from t_chat where key = 'order'), gen_random_uuid(), repeat('x', 1001));
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'an over long message is refused');

  v_failed := false;
  begin
    perform public.send_order_message(
      (select id from t_chat where key = 'order'), null, 'no client id');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a message without a client id is refused');
end;
$$;

do $$
declare v_failed boolean := false; v_rows int;
begin
  perform pg_temp.act_as((select id from t_chat where key = 'stranger'));

  begin
    perform public.send_order_message(
      (select id from t_chat where key = 'order'), gen_random_uuid(), 'let me in');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'an unrelated customer cannot write');

  v_failed := false;
  begin
    select count(*) into v_rows from public.order_messages_page(
      (select id from t_chat where key = 'order'), null, null, 30);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'an unrelated customer cannot read the history');

  set local role authenticated;
  select count(*) into v_rows from public.order_messages
   where order_id = (select id from t_chat where key = 'order');
  perform pg_temp.assert(v_rows = 0, 'row level security hides messages from an unrelated customer');
  reset role;
end;
$$;

do $$
declare v_rows int; v_failed boolean := false;
begin
  set local role authenticated;
  perform pg_temp.act_as((select id from t_chat where key = 'merchant'));

  select count(*) into v_rows from public.order_messages
   where order_id = (select id from t_chat where key = 'order');
  perform pg_temp.assert(v_rows = 0, 'the restaurant cannot read the courier conversation');
  reset role;

  begin
    perform public.send_order_message(
      (select id from t_chat where key = 'order'), gen_random_uuid(), 'merchant here');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'the restaurant cannot write in the conversation');
end;
$$;

do $$
declare v_rows int; v_failed boolean := false;
begin
  set local role authenticated;
  perform pg_temp.act_as((select id from t_chat where key = 'admin'));

  select count(*) into v_rows from public.order_messages
   where order_id = (select id from t_chat where key = 'order');
  perform pg_temp.assert(v_rows = 0, 'an admin does not read order conversations by default');
  reset role;

  begin
    perform public.send_order_message(
      (select id from t_chat where key = 'order'), gen_random_uuid(), 'admin here');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'an admin cannot write in a customer courier conversation');
end;
$$;

do $$
declare v_rows int; v_failed boolean := false;
begin
  set local role anon;
  perform set_config('request.jwt.claims', '', true);

  begin
    select count(*) into v_rows from public.order_messages;
    perform pg_temp.assert(v_rows = 0, 'anonymous visitors read no messages at all');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'anonymous visitors hold no grant on the message table');
  end;

  begin
    perform public.order_messages_page(
      (select id from t_chat where key = 'order'), null, null, 30);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'anonymous visitors cannot call the history function');

  reset role;
end;
$$;

do $$
declare v_notifications int; v_recipient uuid;
begin
  select count(*) into v_notifications
    from public.notifications
   where order_id = (select id from t_chat where key = 'order') and kind = 'order_message';

  select user_id into v_recipient
    from public.notifications
   where order_id = (select id from t_chat where key = 'order') and kind = 'order_message'
   limit 1;

  perform pg_temp.assert(v_notifications = 1, 'sending a message creates one notification');
  perform pg_temp.assert(
    v_recipient = (select id from t_chat where key = 'courier_a'),
    'the notification goes to the other participant');
  perform pg_temp.assert(
    (select body from public.notifications
      where order_id = (select id from t_chat where key = 'order') and kind = 'order_message')
      not like '%ring the top bell%',
    'the notification never repeats the message text');
  perform pg_temp.assert(
    (select data ->> 'order_id' from public.notifications
      where kind = 'order_message' limit 1) = (select id::text from t_chat where key = 'order'),
    'the notification carries the order for deep linking');
end;
$$;

do $$
declare v_message public.order_messages; v_unread int;
begin
  perform pg_temp.act_as((select id from t_chat where key = 'courier_a'));
  v_message := public.send_order_message(
    (select id from t_chat where key = 'order'), gen_random_uuid(), 'On my way');

  perform pg_temp.assert(v_message.sender_role = 'courier', 'the courier message is stored');

  perform pg_temp.act_as((select id from t_chat where key = 'customer'));
  v_unread := public.order_chat_unread_count((select id from t_chat where key = 'order'));
  perform pg_temp.assert(v_unread = 1, 'the customer has one unread message');

  perform pg_temp.act_as((select id from t_chat where key = 'courier_a'));
  v_unread := public.order_chat_unread_count((select id from t_chat where key = 'order'));
  perform pg_temp.assert(v_unread = 1, 'the courier has one unread message');
end;
$$;

do $$
declare v_unread int;
begin
  perform pg_temp.act_as((select id from t_chat where key = 'customer'));
  perform public.mark_order_messages_read((select id from t_chat where key = 'order'));

  v_unread := public.order_chat_unread_count((select id from t_chat where key = 'order'));
  perform pg_temp.assert(v_unread = 0, 'marking read clears the unread count');

  perform pg_temp.assert(
    not exists (
      select 1 from public.notifications
       where user_id = (select id from t_chat where key = 'customer')
         and kind = 'order_message' and read_at is null
    ),
    'marking read also clears the chat notifications');

  perform pg_temp.act_as((select id from t_chat where key = 'courier_a'));
  v_unread := public.order_chat_unread_count((select id from t_chat where key = 'order'));
  perform pg_temp.assert(v_unread = 1, 'one participant reading does not clear the other count');
end;
$$;

do $$
declare v_rows int; v_first timestamptz; v_second uuid;
begin
  perform pg_temp.act_as((select id from t_chat where key = 'customer'));

  insert into public.order_messages (order_id, client_message_id, sender_id, sender_role, body, created_at)
  select (select id from t_chat where key = 'order'), gen_random_uuid(),
         (select id from t_chat where key = 'customer'), 'customer',
         'same instant ' || g, '2026-01-01T10:00:00Z'::timestamptz
    from generate_series(1, 5) g;

  select count(*) into v_rows from public.order_messages_page(
    (select id from t_chat where key = 'order'), null, null, 3);
  perform pg_temp.assert(v_rows = 3, 'the history is paginated');

  perform pg_temp.assert(
    (select count(distinct id) from public.order_messages_page(
      (select id from t_chat where key = 'order'), null, null, 100)) = 7,
    'every message is returned exactly once across a full read');
end;
$$;

do $$
declare
  v_page1 record;
  v_ids uuid[] := '{}';
  v_cursor_created timestamptz;
  v_cursor_id uuid;
  v_row record;
  v_total int := 0;
begin
  perform pg_temp.act_as((select id from t_chat where key = 'customer'));

  for v_row in
    select * from public.order_messages_page(
      (select id from t_chat where key = 'order'), null, null, 3)
  loop
    v_ids := v_ids || v_row.id;
    v_cursor_created := v_row.created_at;
    v_cursor_id := v_row.id;
    v_total := v_total + 1;
  end loop;

  for v_row in
    select * from public.order_messages_page(
      (select id from t_chat where key = 'order'), v_cursor_created, v_cursor_id, 10)
  loop
    perform pg_temp.assert(not (v_row.id = any (v_ids)),
      'paging with identical timestamps never repeats a message');
    v_ids := v_ids || v_row.id;
    v_total := v_total + 1;
  end loop;

  perform pg_temp.assert(v_total = 7, 'keyset paging walks the whole conversation');
end;
$$;

do $$
declare v_rows int; v_failed boolean := false; v_can_send boolean;
begin
  perform pg_temp.act_as_system();
  update public.deliveries
     set courier_id = (select id from t_chat where key = 'courier_b')
   where id = (select id from t_chat where key = 'delivery');

  set local role authenticated;
  perform pg_temp.act_as((select id from t_chat where key = 'courier_a'));
  select count(*) into v_rows from public.order_messages
   where order_id = (select id from t_chat where key = 'order');
  perform pg_temp.assert(v_rows = 0, 'a replaced courier immediately loses read access');
  reset role;

  begin
    perform public.send_order_message(
      (select id from t_chat where key = 'order'), gen_random_uuid(), 'still here');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a replaced courier immediately loses the right to write');

  perform pg_temp.act_as((select id from t_chat where key = 'courier_b'));
  select can_send into v_can_send
    from public.order_chat_access((select id from t_chat where key = 'order'));
  perform pg_temp.assert(v_can_send, 'the new courier can write');

  select count(*) into v_rows from public.order_messages_page(
    (select id from t_chat where key = 'order'), null, null, 100);
  perform pg_temp.assert(v_rows = 7,
    'the new courier keeps the order context from the earlier conversation');
end;
$$;

do $$
declare v_open int; v_closed int;
begin
  select count(*) into v_open from public.delivery_assignments
   where order_id = (select id from t_chat where key = 'order') and unassigned_at is null;
  select count(*) into v_closed from public.delivery_assignments
   where order_id = (select id from t_chat where key = 'order') and unassigned_at is not null;

  perform pg_temp.assert(v_open = 1, 'exactly one courier is assigned at a time');
  perform pg_temp.assert(v_closed = 1, 'the previous assignment is closed in the history');
end;
$$;

do $$
declare v_can_send boolean; v_can_read boolean; v_failed boolean := false; v_reason text;
begin
  perform pg_temp.act_as((select id from t_chat where key = 'admin'));
  perform public.transition_order_status(
    (select id from t_chat where key = 'order'), 'courier_assigned'::public.order_status);
  perform public.transition_order_status(
    (select id from t_chat where key = 'order'), 'picked_up'::public.order_status);
  perform public.transition_order_status(
    (select id from t_chat where key = 'order'), 'delivering'::public.order_status);
  perform public.transition_order_status(
    (select id from t_chat where key = 'order'), 'delivered'::public.order_status);

  perform pg_temp.act_as((select id from t_chat where key = 'customer'));
  select can_read, can_send, reason into v_can_read, v_can_send, v_reason
    from public.order_chat_access((select id from t_chat where key = 'order'));
  perform pg_temp.assert(v_can_read, 'the customer still reads history after delivery');
  perform pg_temp.assert(not v_can_send, 'the customer cannot write after delivery');
  perform pg_temp.assert(v_reason = 'order_closed', 'the closed state is explained');

  begin
    perform public.send_order_message(
      (select id from t_chat where key = 'order'), gen_random_uuid(), 'one more thing');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'writing after delivery is refused');

  perform pg_temp.act_as((select id from t_chat where key = 'courier_b'));
  select can_read, can_send into v_can_read, v_can_send
    from public.order_chat_access((select id from t_chat where key = 'order'));
  perform pg_temp.assert(v_can_read, 'the final courier still reads history after delivery');
  perform pg_temp.assert(not v_can_send, 'the final courier cannot write after delivery');

  set local role authenticated;
  perform pg_temp.act_as((select id from t_chat where key = 'courier_a'));
  perform pg_temp.assert(
    (select count(*) from public.order_messages
      where order_id = (select id from t_chat where key = 'order')) = 0,
    'a replaced courier has no terminal read access either');
  reset role;
end;
$$;


do $$
declare v_rows int; v_notification_id uuid;
begin
  perform pg_temp.act_as_system();

  insert into public.push_tokens (user_id, token, platform)
  values ((select id from t_chat where key = 'courier_a'), 'ExponentPushToken[courierA]', 'android')
  on conflict do nothing;
  insert into public.push_tokens (user_id, token, platform)
  values ((select id from t_chat where key = 'courier_b'), 'ExponentPushToken[courierB]', 'android')
  on conflict do nothing;

  insert into public.notifications (user_id, order_id, audience, kind, title, body, data)
  values ((select id from t_chat where key = 'courier_a'),
          (select id from t_chat where key = 'order'),
          'courier', 'order_message', 'New message', 'someone sent you a message',
          jsonb_build_object('order_id', (select id from t_chat where key = 'order'),
                             'message_id', gen_random_uuid(), 'route', '/order/chat'))
  returning id into v_notification_id;

  select count(*) into v_rows from public.claim_notifications_for_push(50)
   where notification_id = v_notification_id;
  perform pg_temp.assert(v_rows = 0,
    'a chat push for a replaced courier is dropped at dispatch time');

  perform pg_temp.assert(
    public.notification_recipient_still_authorised(
      'order_message',
      (select id from t_chat where key = 'courier_b'),
      (select id from t_chat where key = 'order')),
    'the currently assigned courier is still a valid push recipient');

  perform pg_temp.assert(
    public.notification_recipient_still_authorised(
      'order_message',
      (select id from t_chat where key = 'customer'),
      (select id from t_chat where key = 'order')),
    'the customer is always a valid push recipient for their own order');

  perform pg_temp.assert(
    not public.notification_recipient_still_authorised(
      'order_message',
      (select id from t_chat where key = 'stranger'),
      (select id from t_chat where key = 'order')),
    'an unrelated user is never a valid push recipient');

  perform pg_temp.assert(
    public.notification_recipient_still_authorised(
      'order_status', (select id from t_chat where key = 'stranger'), null),
    'other notification kinds are left alone by the chat recheck');
end;
$$;

rollback;
