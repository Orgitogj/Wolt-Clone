create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  body text check (body is null or char_length(body) <= 1000),
  status text not null default 'visible' check (status in ('visible', 'hidden', 'removed')),
  moderated_by uuid references auth.users (id) on delete set null,
  moderated_at timestamptz,
  moderation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reviews_restaurant_idx
  on public.reviews (restaurant_id, created_at desc);
create index if not exists reviews_user_idx on public.reviews (user_id, created_at desc);
create index if not exists reviews_visible_idx
  on public.reviews (restaurant_id) where status = 'visible';

create table if not exists public.review_responses (
  review_id uuid primary key references public.reviews (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  responder_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reviews enable row level security;
alter table public.review_responses enable row level security;

revoke all on public.reviews from anon, authenticated;
revoke all on public.review_responses from anon, authenticated;
grant select on public.reviews to anon, authenticated;
grant select on public.review_responses to anon, authenticated;

drop policy if exists "read visible reviews" on public.reviews;
create policy "read visible reviews" on public.reviews
  for select using (
    status = 'visible'
    or user_id = auth.uid()
    or public.manages_restaurant(restaurant_id)
    or public.is_admin()
  );

drop policy if exists "read review responses" on public.review_responses;
create policy "read review responses" on public.review_responses
  for select using (
    exists (
      select 1 from public.reviews r
       where r.id = review_id
         and (
           r.status = 'visible'
           or r.user_id = auth.uid()
           or public.manages_restaurant(r.restaurant_id)
           or public.is_admin()
         )
    )
  );

create or replace function public.restaurant_rating_sync(p_restaurant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_average numeric(2,1);
begin
  select count(*), round(avg(rating)::numeric, 1)
    into v_count, v_average
    from public.reviews
   where restaurant_id = p_restaurant_id
     and status = 'visible';

  if v_count = 0 then
    return;
  end if;

  perform set_config('app.rating_sync', '1', true);
  update public.restaurants
     set rating = v_average,
         review_count = v_count
   where id = p_restaurant_id;
  perform set_config('app.rating_sync', '', true);
end;
$$;

create or replace function public.reviews_sync_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.restaurant_rating_sync(coalesce(new.restaurant_id, old.restaurant_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists reviews_sync_rating on public.reviews;
create trigger reviews_sync_rating
  after insert or update or delete on public.reviews
  for each row execute function public.reviews_sync_rating();

create or replace function public.restaurants_guard_rating()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.rating is distinct from old.rating or new.review_count is distinct from old.review_count)
     and coalesce(current_setting('app.rating_sync', true), '') <> '1'
     and auth.uid() is not null
     and not public.is_admin()
  then
    raise exception 'Ratings are calculated from reviews and cannot be set directly'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists restaurants_guard_rating on public.restaurants;
create trigger restaurants_guard_rating
  before update on public.restaurants
  for each row execute function public.restaurants_guard_rating();

create or replace function public.review_eligibility(p_order_id uuid)
returns table (can_review boolean, reason text, review_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when o.id is null then false
      when o.user_id is distinct from auth.uid() then false
      when o.status <> 'delivered' then false
      when r.id is not null then false
      else true
    end as can_review,
    case
      when o.id is null then 'not_found'
      when o.user_id is distinct from auth.uid() then 'not_your_order'
      when o.status <> 'delivered' then 'not_delivered'
      when r.id is not null then 'already_reviewed'
      else 'eligible'
    end as reason,
    r.id as review_id
  from (select 1) placeholder
  left join public.orders o on o.id = p_order_id
  left join public.reviews r on r.order_id = p_order_id;
$$;

create or replace function public.submit_review(
  p_order_id uuid,
  p_rating int,
  p_body text default null
)
returns public.reviews
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_review public.reviews;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if auth.uid() is null then
    raise exception 'You must be signed in' using errcode = '28000';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5' using errcode = '22023';
  end if;

  if v_body is not null and char_length(v_body) > 1000 then
    raise exception 'Review text is too long' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;

  if v_order.id is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if v_order.user_id is distinct from auth.uid() then
    raise exception 'You can only review your own orders' using errcode = '42501';
  end if;

  if v_order.status <> 'delivered' then
    raise exception 'You can only review a delivered order' using errcode = '42501';
  end if;

  insert into public.reviews (order_id, restaurant_id, user_id, rating, body)
  values (p_order_id, v_order.restaurant_id, auth.uid(), p_rating, v_body)
  returning * into v_review;

  return v_review;
exception
  when unique_violation then
    raise exception 'You have already reviewed this order' using errcode = '23505';
end;
$$;

create or replace function public.update_review(
  p_review_id uuid,
  p_rating int,
  p_body text default null
)
returns public.reviews
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.reviews;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5' using errcode = '22023';
  end if;

  if v_body is not null and char_length(v_body) > 1000 then
    raise exception 'Review text is too long' using errcode = '22023';
  end if;

  select * into v_review from public.reviews where id = p_review_id for update;

  if v_review.id is null then
    raise exception 'Review not found' using errcode = 'P0002';
  end if;

  if v_review.user_id is distinct from auth.uid() then
    raise exception 'You can only edit your own review' using errcode = '42501';
  end if;

  if v_review.status = 'removed' then
    raise exception 'This review has been removed' using errcode = '42501';
  end if;

  update public.reviews
     set rating = p_rating,
         body = v_body,
         updated_at = now()
   where id = p_review_id
  returning * into v_review;

  return v_review;
end;
$$;

create or replace function public.delete_review(p_review_id uuid)
returns public.reviews
language plpgsql
security definer
set search_path = public
as $$
declare v_review public.reviews;
begin
  select * into v_review from public.reviews where id = p_review_id for update;

  if v_review.id is null then
    raise exception 'Review not found' using errcode = 'P0002';
  end if;

  if v_review.user_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'You can only delete your own review' using errcode = '42501';
  end if;

  delete from public.reviews where id = p_review_id;
  return v_review;
end;
$$;

create or replace function public.respond_to_review(p_review_id uuid, p_body text)
returns public.review_responses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.reviews;
  v_response public.review_responses;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if v_body is null or char_length(v_body) > 1000 then
    raise exception 'A response must be between 1 and 1000 characters' using errcode = '22023';
  end if;

  select * into v_review from public.reviews where id = p_review_id;

  if v_review.id is null then
    raise exception 'Review not found' using errcode = 'P0002';
  end if;

  if not public.manages_restaurant(v_review.restaurant_id) and not public.is_admin() then
    raise exception 'Only the restaurant can respond to this review' using errcode = '42501';
  end if;

  if v_review.status <> 'visible' then
    raise exception 'This review is not open for responses' using errcode = '42501';
  end if;

  insert into public.review_responses (review_id, restaurant_id, responder_id, body)
  values (p_review_id, v_review.restaurant_id, auth.uid(), v_body)
  on conflict (review_id) do update
     set body = excluded.body,
         responder_id = excluded.responder_id,
         updated_at = now()
  returning * into v_response;

  return v_response;
end;
$$;

create or replace function public.moderate_review(
  p_review_id uuid,
  p_status text,
  p_reason text default null
)
returns public.reviews
language plpgsql
security definer
set search_path = public
as $$
declare v_review public.reviews;
begin
  perform public.require_admin();

  if p_status not in ('visible', 'hidden', 'removed') then
    raise exception 'Unknown moderation status' using errcode = '22023';
  end if;

  update public.reviews
     set status = p_status,
         moderated_by = auth.uid(),
         moderated_at = now(),
         moderation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         updated_at = now()
   where id = p_review_id
  returning * into v_review;

  if v_review.id is null then
    raise exception 'Review not found' using errcode = 'P0002';
  end if;

  insert into public.admin_actions (admin_id, action, subject_type, subject_id, details)
  values (
    auth.uid(),
    'moderate_review',
    'review',
    p_review_id::text,
    jsonb_build_object('status', p_status, 'reason', p_reason)
  );

  return v_review;
end;
$$;

create or replace function public.restaurant_reviews(
  p_restaurant_id uuid,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  rating int,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  reviewer_name text,
  is_mine boolean,
  response_body text,
  response_created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.rating,
    r.body,
    r.created_at,
    r.updated_at,
    coalesce(nullif(split_part(coalesce(p.full_name, ''), ' ', 1), ''), 'Customer') as reviewer_name,
    r.user_id = auth.uid() as is_mine,
    resp.body as response_body,
    resp.created_at as response_created_at
  from public.reviews r
  left join public.profiles p on p.id = r.user_id
  left join public.review_responses resp on resp.review_id = r.id
 where r.restaurant_id = p_restaurant_id
   and r.status = 'visible'
 order by r.created_at desc, r.id
 limit public.search_page_size(p_limit)
offset public.search_page_offset(p_offset);
$$;

create or replace function public.restaurant_review_summary(p_restaurant_id uuid)
returns table (review_count int, average_rating numeric, rating_breakdown jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with visible as (
    select rating
      from public.reviews
     where restaurant_id = p_restaurant_id
       and status = 'visible'
  ),
  buckets as (
    select jsonb_object_agg(grouped.rating::text, grouped.total) as breakdown
      from (
        select rating, count(*)::int as total
          from visible
         group by rating
      ) grouped
  )
  select
    (select count(*)::int from visible) as review_count,
    (select coalesce(round(avg(rating)::numeric, 1), 0) from visible) as average_rating,
    coalesce((select breakdown from buckets), '{}'::jsonb) as rating_breakdown;
$$;

create or replace function public.my_reviews(p_limit int default 20, p_offset int default 0)
returns table (
  id uuid,
  order_id uuid,
  restaurant_id uuid,
  restaurant_name text,
  rating int,
  body text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  response_body text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.order_id,
    r.restaurant_id,
    rest.name as restaurant_name,
    r.rating,
    r.body,
    r.status,
    r.created_at,
    r.updated_at,
    resp.body as response_body
  from public.reviews r
  join public.restaurants rest on rest.id = r.restaurant_id
  left join public.review_responses resp on resp.review_id = r.id
 where r.user_id = auth.uid()
 order by r.created_at desc, r.id
 limit public.search_page_size(p_limit)
offset public.search_page_offset(p_offset);
$$;

revoke all on function public.restaurant_rating_sync(uuid) from public, anon;
revoke all on function public.review_eligibility(uuid) from public, anon;
revoke all on function public.submit_review(uuid, int, text) from public, anon;
revoke all on function public.update_review(uuid, int, text) from public, anon;
revoke all on function public.delete_review(uuid) from public, anon;
revoke all on function public.respond_to_review(uuid, text) from public, anon;
revoke all on function public.moderate_review(uuid, text, text) from public, anon;
revoke all on function public.my_reviews(int, int) from public, anon;
revoke all on function public.restaurant_reviews(uuid, int, int) from public;
revoke all on function public.restaurant_review_summary(uuid) from public;

grant execute on function public.review_eligibility(uuid) to authenticated;
grant execute on function public.submit_review(uuid, int, text) to authenticated;
grant execute on function public.update_review(uuid, int, text) to authenticated;
grant execute on function public.delete_review(uuid) to authenticated;
grant execute on function public.respond_to_review(uuid, text) to authenticated;
grant execute on function public.moderate_review(uuid, text, text) to authenticated;
grant execute on function public.restaurant_reviews(uuid, int, int) to anon, authenticated;
grant execute on function public.restaurant_review_summary(uuid) to anon, authenticated;
grant execute on function public.my_reviews(int, int) to authenticated;

create or replace function public.manage_reviews(
  p_restaurant_id uuid default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  restaurant_id uuid,
  restaurant_name text,
  rating int,
  body text,
  status text,
  created_at timestamptz,
  moderation_reason text,
  reviewer_name text,
  response_body text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.restaurant_id,
    rest.name as restaurant_name,
    r.rating,
    r.body,
    r.status,
    r.created_at,
    r.moderation_reason,
    coalesce(nullif(split_part(coalesce(p.full_name, ''), ' ', 1), ''), 'Customer') as reviewer_name,
    resp.body as response_body
  from public.reviews r
  join public.restaurants rest on rest.id = r.restaurant_id
  left join public.profiles p on p.id = r.user_id
  left join public.review_responses resp on resp.review_id = r.id
 where (p_restaurant_id is null or r.restaurant_id = p_restaurant_id)
   and (public.is_admin() or public.manages_restaurant(r.restaurant_id))
 order by r.created_at desc, r.id
 limit public.search_page_size(p_limit)
offset public.search_page_offset(p_offset);
$$;


revoke all on function public.manage_reviews(uuid, int, int) from public, anon;
grant execute on function public.manage_reviews(uuid, int, int) to authenticated;
