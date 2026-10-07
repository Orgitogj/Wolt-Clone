create table if not exists public.restaurant_search (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  document tsvector not null
);

create index if not exists restaurant_search_document_idx
  on public.restaurant_search using gin (document);

alter table public.restaurant_search enable row level security;

drop policy if exists "public read restaurant_search" on public.restaurant_search;
create policy "public read restaurant_search" on public.restaurant_search for select using (true);

grant select on public.restaurant_search to anon, authenticated;

create or replace function public.restaurant_search_document(
  p_name text,
  p_description text,
  p_cuisines text[],
  p_tags text[]
)
returns tsvector
language plpgsql
stable
set search_path = public
as $$
begin
  return to_tsvector(
    'simple',
    coalesce(p_name, '') || ' ' ||
    coalesce(p_description, '') || ' ' ||
    coalesce(array_to_string(p_cuisines, ' '), '') || ' ' ||
    coalesce(array_to_string(p_tags, ' '), '')
  );
end;
$$;

create or replace function public.restaurant_search_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.restaurant_search (restaurant_id, document)
  values (
    new.id,
    public.restaurant_search_document(new.name, new.description, new.cuisines, new.tags)
  )
  on conflict (restaurant_id) do update set document = excluded.document;
  return new;
end;
$$;

drop trigger if exists restaurant_search_sync on public.restaurants;
create trigger restaurant_search_sync
  after insert or update of name, description, cuisines, tags
  on public.restaurants
  for each row execute function public.restaurant_search_sync();

insert into public.restaurant_search (restaurant_id, document)
select r.id, public.restaurant_search_document(r.name, r.description, r.cuisines, r.tags)
  from public.restaurants r
on conflict (restaurant_id) do update set document = excluded.document;

create index if not exists dishes_search_idx on public.dishes using gin (
  to_tsvector('simple', name || ' ' || coalesce(description, ''))
) where is_available;

create index if not exists restaurants_rating_idx on public.restaurants (rating desc, id);
create index if not exists restaurants_delivery_fee_idx on public.restaurants (delivery_fee, id);
create index if not exists restaurants_delivery_time_idx on public.restaurants (delivery_time_min, id);

create index if not exists restaurant_categories_category_idx
  on public.restaurant_categories (category_id, restaurant_id);

create or replace function public.search_query(p_search text)
returns tsquery
language sql
immutable
as $$
  select case
    when p_search is null or btrim(p_search) = '' then null
    else websearch_to_tsquery('simple', btrim(p_search))
  end;
$$;

create or replace function public.search_page_size(p_limit int)
returns int
language sql
immutable
as $$
  select least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

create or replace function public.search_page_offset(p_offset int)
returns int
language sql
immutable
as $$
  select least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;

create or replace function public.search_restaurants(
  p_search text default null,
  p_category_id uuid default null,
  p_cuisines text[] default null,
  p_price_tier text default null,
  p_wolt_plus_only boolean default false,
  p_sort text default 'Recommended',
  p_limit int default 20,
  p_offset int default 0
)
returns setof public.restaurants
language sql
stable
set search_path = public
as $$
  with params as (
    select
      public.search_query(p_search) as q,
      public.search_page_size(p_limit) as lim,
      public.search_page_offset(p_offset) as off
  )
  select r.*
    from public.restaurants r, params p
   where (
           p.q is null
           or exists (
                select 1 from public.restaurant_search s
                 where s.restaurant_id = r.id and s.document @@ p.q
              )
         )
     and (p_category_id is null or exists (
           select 1 from public.restaurant_categories rc
            where rc.restaurant_id = r.id and rc.category_id = p_category_id
         ))
     and (p_cuisines is null or array_length(p_cuisines, 1) is null or r.cuisines && p_cuisines)
     and (
           p_price_tier is null
           or (p_price_tier = '€' and r.delivery_fee <= 1.5)
           or (p_price_tier = '€€' and r.delivery_fee > 1.5 and r.delivery_fee <= 2.5)
           or (p_price_tier = '€€€' and r.delivery_fee > 2.5 and r.delivery_fee <= 3.5)
           or (p_price_tier = '€€€€' and r.delivery_fee > 3.5)
         )
     and (not coalesce(p_wolt_plus_only, false) or exists (
           select 1 from unnest(r.tags) as tag where tag ilike '%wolt+%'
         ))
   order by
     case when p_sort = 'Delivery price' then r.delivery_fee end asc nulls last,
     case when p_sort = 'Delivery time' then r.delivery_time_min end asc nulls last,
     case when p_sort in ('Rating', 'Recommended') or p_sort is null then r.rating end desc nulls last,
     r.id
   limit (select lim from params)
  offset (select off from params);
$$;

create or replace function public.search_restaurants_in_bounds(
  p_min_lat double precision,
  p_min_lng double precision,
  p_max_lat double precision,
  p_max_lng double precision,
  p_cuisines text[] default null,
  p_price_tier text default null,
  p_wolt_plus_only boolean default false,
  p_sort text default 'Recommended',
  p_limit int default 50
)
returns setof public.restaurants
language sql
stable
set search_path = public
as $$
  select r.*
    from public.restaurants r
   where r.latitude is not null
     and r.longitude is not null
     and r.latitude between least(p_min_lat, p_max_lat) and greatest(p_min_lat, p_max_lat)
     and r.longitude between least(p_min_lng, p_max_lng) and greatest(p_min_lng, p_max_lng)
     and (p_cuisines is null or array_length(p_cuisines, 1) is null or r.cuisines && p_cuisines)
     and (
           p_price_tier is null
           or (p_price_tier = '€' and r.delivery_fee <= 1.5)
           or (p_price_tier = '€€' and r.delivery_fee > 1.5 and r.delivery_fee <= 2.5)
           or (p_price_tier = '€€€' and r.delivery_fee > 2.5 and r.delivery_fee <= 3.5)
           or (p_price_tier = '€€€€' and r.delivery_fee > 3.5)
         )
     and (not coalesce(p_wolt_plus_only, false) or exists (
           select 1 from unnest(r.tags) as tag where tag ilike '%wolt+%'
         ))
   order by
     case when p_sort = 'Delivery price' then r.delivery_fee end asc nulls last,
     case when p_sort = 'Delivery time' then r.delivery_time_min end asc nulls last,
     case when p_sort in ('Rating', 'Recommended') or p_sort is null then r.rating end desc nulls last,
     r.id
   limit public.search_page_size(p_limit);
$$;

create or replace function public.search_dishes(
  p_search text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns setof public.dishes
language sql
stable
set search_path = public
as $$
  with params as (
    select
      public.search_query(p_search) as q,
      public.search_page_size(p_limit) as lim,
      public.search_page_offset(p_offset) as off
  )
  select d.*
    from public.dishes d, params p
   where d.is_available
     and p.q is not null
     and to_tsvector('simple', d.name || ' ' || coalesce(d.description, '')) @@ p.q
   order by d.name, d.id
   limit (select lim from params)
  offset (select off from params);
$$;

create or replace function public.distinct_cuisines()
returns table (cuisine text)
language sql
stable
set search_path = public
as $$
  select distinct unnest(cuisines) as cuisine
    from public.restaurants
   order by 1;
$$;

revoke all on function public.restaurant_search_document(text, text, text[], text[]) from public;
revoke all on function public.search_query(text) from public;
revoke all on function public.search_page_size(int) from public;
revoke all on function public.search_page_offset(int) from public;
revoke all on function public.search_restaurants(text, uuid, text[], text, boolean, text, int, int) from public;
revoke all on function public.search_restaurants_in_bounds(
  double precision, double precision, double precision, double precision,
  text[], text, boolean, text, int
) from public;
revoke all on function public.search_dishes(text, int, int) from public;
revoke all on function public.distinct_cuisines() from public;

grant execute on function public.restaurant_search_document(text, text, text[], text[])
  to anon, authenticated;
grant execute on function public.search_query(text) to anon, authenticated;
grant execute on function public.search_page_size(int) to anon, authenticated;
grant execute on function public.search_page_offset(int) to anon, authenticated;
grant execute on function public.search_restaurants(text, uuid, text[], text, boolean, text, int, int)
  to anon, authenticated;
grant execute on function public.search_restaurants_in_bounds(
  double precision, double precision, double precision, double precision,
  text[], text, boolean, text, int
) to anon, authenticated;
grant execute on function public.search_dishes(text, int, int) to anon, authenticated;
grant execute on function public.distinct_cuisines() to anon, authenticated;
