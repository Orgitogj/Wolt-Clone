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
    join public.push_tokens t on t.user_id = s.user_id;
$$;

create or replace function public.release_notifications_for_push(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.notifications
     set pushed_at = null
   where id = any (coalesce(p_ids, '{}'::uuid[]))
     and pushed_at is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.discard_push_token(p_token text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.push_tokens where token = p_token;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.claim_notifications_for_push(int)
  from public, anon, authenticated;
revoke all on function public.release_notifications_for_push(uuid[])
  from public, anon, authenticated;
revoke all on function public.discard_push_token(text)
  from public, anon, authenticated;

grant execute on function public.claim_notifications_for_push(int) to service_role;
grant execute on function public.release_notifications_for_push(uuid[]) to service_role;
grant execute on function public.discard_push_token(text) to service_role;
