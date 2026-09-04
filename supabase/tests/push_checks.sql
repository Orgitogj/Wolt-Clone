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

create temporary table t_ids (key text primary key, id uuid not null) on commit drop;
grant all on t_ids to authenticated;

insert into auth.users (id, email) values
  (gen_random_uuid(), 'one@push.test'),
  (gen_random_uuid(), 'two@push.test'),
  (gen_random_uuid(), 'silent@push.test');

insert into t_ids (key, id)
select 'one', id from auth.users where email = 'one@push.test'
union all select 'two', id from auth.users where email = 'two@push.test'
union all select 'silent', id from auth.users where email = 'silent@push.test';

insert into public.push_tokens (user_id, token, platform)
select id, 'ExponentPushToken[one-phone]', 'ios' from t_ids where key = 'one';
insert into public.push_tokens (user_id, token, platform)
select id, 'ExponentPushToken[one-tablet]', 'android' from t_ids where key = 'one';
insert into public.push_tokens (user_id, token, platform)
select id, 'ExponentPushToken[two-phone]', 'android' from t_ids where key = 'two';

insert into public.notifications (user_id, audience, kind, title, body)
select id, 'customer', 'placed', 'Order placed', 'We sent your order.' from t_ids where key = 'one';
insert into t_ids (key, id)
select 'notification_one', id from public.notifications where user_id = (select id from t_ids where key = 'one');

insert into public.notifications (user_id, audience, kind, title, body)
select id, 'customer', 'placed', 'Order placed', 'We sent your order.'
  from t_ids where key = 'silent';
insert into t_ids (key, id)
select 'notification_silent', id from public.notifications
 where user_id = (select id from t_ids where key = 'silent');

insert into public.notifications (user_id, audience, kind, title, body, created_at)
select id, 'customer', 'delivered', 'Delivered', 'Enjoy.', now() - interval '2 days'
  from t_ids where key = 'two';
insert into t_ids (key, id)
select 'notification_stale', id from public.notifications where kind = 'delivered';

do $$ begin perform pg_temp.act_as((select id from t_ids where key = 'one')); end $$;
set local role authenticated;

do $$
declare v_failed boolean := false;
begin
  begin
    perform public.claim_notifications_for_push(10);
  exception when insufficient_privilege then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a signed in user cannot claim notifications for push');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    perform public.discard_push_token('ExponentPushToken[two-phone]');
  exception when insufficient_privilege then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a signed in user cannot delete another push token');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  begin
    perform public.release_notifications_for_push(
      array[(select id from t_ids where key = 'notification_one')]);
  exception when insufficient_privilege then v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a signed in user cannot release a claimed notification');
end;
$$;
reset role;

do $$
declare
  v_rows int;
  v_tokens text[];
  v_payload jsonb;
begin
  select count(*), array_agg(token order by token)
    into v_rows, v_tokens
    from public.claim_notifications_for_push(100);

  perform pg_temp.assert(v_rows = 2, 'a claim returns one row per registered device');
  perform pg_temp.assert(
    v_tokens = array['ExponentPushToken[one-phone]', 'ExponentPushToken[one-tablet]'],
    'both of the devices belonging to the recipient are returned');

  perform pg_temp.assert(
    (select pushed_at is not null from public.notifications
      where id = (select id from t_ids where key = 'notification_one')),
    'claiming stamps the notification as pushed');

  perform pg_temp.assert(
    (select pushed_at is not null from public.notifications
      where id = (select id from t_ids where key = 'notification_silent')),
    'a recipient with no device is stamped so it is not retried forever');

  perform pg_temp.assert(
    (select pushed_at is null from public.notifications
      where id = (select id from t_ids where key = 'notification_stale')),
    'a notification older than a day is left alone');
end;
$$;

do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.claim_notifications_for_push(100)) = 0,
    'a second claim sends nothing twice');
end;
$$;

do $$
declare v_released int;
begin
  v_released := public.release_notifications_for_push(
    array[(select id from t_ids where key = 'notification_one')]);

  perform pg_temp.assert(v_released = 1, 'a failed send releases its claim');
  perform pg_temp.assert(
    (select pushed_at is null from public.notifications
      where id = (select id from t_ids where key = 'notification_one')),
    'a released notification is unstamped');
  perform pg_temp.assert(
    (select count(*) from public.claim_notifications_for_push(100)) = 2,
    'a released notification is claimed again on the next run');
end;
$$;

do $$
declare v_data jsonb;
begin
  perform public.release_notifications_for_push(
    array[(select id from t_ids where key = 'notification_one')]);

  select data into v_data
    from public.claim_notifications_for_push(100)
   where token = 'ExponentPushToken[one-phone]';

  perform pg_temp.assert(
    (v_data ->> 'notification_id')::uuid = (select id from t_ids where key = 'notification_one'),
    'the push payload carries the notification id');
  perform pg_temp.assert(v_data ->> 'kind' = 'placed',
    'the push payload carries the notification kind');
end;
$$;

do $$
declare v_discarded int;
begin
  v_discarded := public.discard_push_token('ExponentPushToken[one-tablet]');
  perform pg_temp.assert(v_discarded = 1, 'an unregistered device token is discarded');
  perform pg_temp.assert(
    (select count(*) from public.push_tokens
      where user_id = (select id from t_ids where key = 'one')) = 1,
    'discarding one device leaves the other registered');
end;
$$;

rollback;
