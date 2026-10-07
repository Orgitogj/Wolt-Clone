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

create temporary table t_search_ids (
  key text primary key,
  id uuid not null
) on commit drop;

insert into public.restaurants
  (name, description, rating, delivery_fee, delivery_time_min, cuisines, tags, is_open)
values
  ('Sushi Garden', 'Fresh nigiri and maki', 4.8, 1.00, 20, array['Japanese'], array['Wolt+'], true),
  ('Pizza Napoli', 'Wood fired pizza', 4.2, 2.00, 35, array['Italian'], array['Popular'], true),
  ('Burger Barn', 'Smash burgers and fries', 3.9, 4.00, 15, array['American'], array['Wolt+'], true),
  ('Green Bowl', 'Vegan poke bowls', 4.5, 3.00, 25, array['Vegan','Japanese'], array['New'], true);

insert into t_search_ids (key, id)
select 'sushi', id from public.restaurants where name = 'Sushi Garden'
union all
select 'pizza', id from public.restaurants where name = 'Pizza Napoli'
union all
select 'burger', id from public.restaurants where name = 'Burger Barn'
union all
select 'green', id from public.restaurants where name = 'Green Bowl';

insert into public.categories (name, sort_order) values ('Asian', 1);
insert into t_search_ids (key, id)
select 'category_asian', id from public.categories where name = 'Asian';

insert into public.restaurant_categories (restaurant_id, category_id)
select r.id, c.id
  from t_search_ids r, t_search_ids c
 where r.key in ('sushi', 'green') and c.key = 'category_asian';

insert into public.menu_categories (restaurant_id, name)
select id, 'Mains' from t_search_ids where key = 'sushi';

insert into public.dishes (restaurant_id, menu_category_id, name, description, price, is_available)
select r.id, m.id, 'Salmon Nigiri', 'Two pieces of salmon', 6.50, true
  from t_search_ids r
  join public.menu_categories m on m.restaurant_id = r.id
 where r.key = 'sushi';

insert into public.dishes (restaurant_id, menu_category_id, name, description, price, is_available)
select r.id, m.id, 'Hidden Nigiri', 'Sold out today', 7.50, false
  from t_search_ids r
  join public.menu_categories m on m.restaurant_id = r.id
 where r.key = 'sushi';

do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.search_restaurants(null, null, null, null, false, 'Recommended', 50, 0)) = 4,
    'an empty query returns every restaurant');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants('   ', null, null, null, false, 'Recommended', 50, 0)) = 4,
    'a blank query is treated as no query');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants('sushi', null, null, null, false, 'Recommended', 50, 0)) = 1,
    'name search matches a restaurant');

  perform pg_temp.assert(
    (select name from public.search_restaurants('nigiri', null, null, null, false, 'Recommended', 50, 0)) = 'Sushi Garden',
    'description text is searchable');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants('Japanese', null, null, null, false, 'Recommended', 50, 0)) = 2,
    'cuisine names are searchable');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants('definitelynotathing', null, null, null, false, 'Recommended', 50, 0)) = 0,
    'an unmatched query returns nothing');
end;
$$;

do $$
declare v_category uuid;
begin
  select id into v_category from t_search_ids where key = 'category_asian';

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants(null, v_category, null, null, false, 'Recommended', 50, 0)) = 2,
    'category filter narrows the result set');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants(null, null, array['Italian'], null, false, 'Recommended', 50, 0)) = 1,
    'cuisine filter narrows the result set');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants(null, null, array['Italian','Vegan'], null, false, 'Recommended', 50, 0)) = 2,
    'cuisine filter matches any selected cuisine');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants(null, null, '{}'::text[], null, false, 'Recommended', 50, 0)) = 4,
    'an empty cuisine array does not filter anything out');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants(null, null, null, '€', false, 'Recommended', 50, 0)) = 1,
    'the cheapest price tier matches fees up to 1.50');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants(null, null, null, '€€€€', false, 'Recommended', 50, 0)) = 1,
    'the top price tier matches fees above 3.50');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants(null, null, null, null, true, 'Recommended', 50, 0)) = 2,
    'the wolt plus filter only keeps tagged restaurants');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants('garden', v_category, array['Japanese'], '€', true, 'Recommended', 50, 0)) = 1,
    'filters combine with the text query');
end;
$$;

do $$
begin
  perform pg_temp.assert(
    (select name from public.search_restaurants(null, null, null, null, false, 'Rating', 1, 0)) = 'Sushi Garden',
    'rating sort puts the best rated first');

  perform pg_temp.assert(
    (select name from public.search_restaurants(null, null, null, null, false, 'Delivery price', 1, 0)) = 'Sushi Garden',
    'delivery price sort puts the cheapest first');

  perform pg_temp.assert(
    (select name from public.search_restaurants(null, null, null, null, false, 'Delivery time', 1, 0)) = 'Burger Barn',
    'delivery time sort puts the fastest first');

  perform pg_temp.assert(
    (select name from public.search_restaurants(null, null, null, null, false, 'Recommended', 1, 0)) = 'Sushi Garden',
    'the default sort is by rating');
end;
$$;

do $$
declare
  v_first uuid;
  v_second uuid;
begin
  perform pg_temp.assert(
    (select count(*) from public.search_restaurants(null, null, null, null, false, 'Rating', 2, 0)) = 2,
    'the limit caps the page size');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants(null, null, null, null, false, 'Rating', 2, 2)) = 2,
    'the offset returns the next page');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants(null, null, null, null, false, 'Rating', 50, 4)) = 0,
    'an offset past the end returns nothing');

  select id into v_first from public.search_restaurants(null, null, null, null, false, 'Rating', 1, 0);
  select id into v_second from public.search_restaurants(null, null, null, null, false, 'Rating', 1, 1);
  perform pg_temp.assert(v_first <> v_second, 'paging does not repeat a row');
end;
$$;

do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.search_dishes('nigiri', 50, 0)) = 1,
    'dish search matches an available dish');

  perform pg_temp.assert(
    (select name from public.search_dishes('salmon', 50, 0)) = 'Salmon Nigiri',
    'dish description text is searchable');

  perform pg_temp.assert(
    (select count(*) from public.search_dishes(null, 50, 0)) = 0,
    'an empty dish query returns nothing');

  perform pg_temp.assert(
    (select count(*) from public.search_dishes('   ', 50, 0)) = 0,
    'a blank dish query returns nothing');

  perform pg_temp.assert(
    not exists (select 1 from public.search_dishes('hidden', 50, 0)),
    'unavailable dishes never appear in search');
end;
$$;

do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.distinct_cuisines()) = 4,
    'distinct cuisines returns each cuisine once');

  perform pg_temp.assert(
    (select cuisine from public.distinct_cuisines() limit 1) = 'American',
    'distinct cuisines are sorted');
end;
$$;

do $$
declare v_anon_count int;
begin
  set local role anon;
  select count(*) into v_anon_count
    from public.search_restaurants(null, null, null, null, false, 'Recommended', 50, 0);
  perform pg_temp.assert(v_anon_count = 4, 'anonymous visitors can browse the catalogue');
  reset role;
end;
$$;


do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.search_restaurants('sushi & garden!', null, null, null, false, 'Recommended', 50, 0)) >= 0,
    'punctuation in a query does not raise');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants('"pizza napoli"', null, null, null, false, 'Recommended', 50, 0)) = 1,
    'a quoted phrase is matched as a phrase');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants('pizza -napoli', null, null, null, false, 'Recommended', 50, 0)) = 0,
    'a negated term is honoured');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants('!@#$%^&*()', null, null, null, false, 'Recommended', 50, 0)) = 0,
    'a query of only punctuation returns nothing instead of failing');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants(repeat('a', 2000), null, null, null, false, 'Recommended', 50, 0)) = 0,
    'a very long query is handled safely');

  perform pg_temp.assert(
    (select count(*) from public.search_dishes('salmon''s & <nigiri>', 50, 0)) >= 0,
    'punctuation in a dish query does not raise');
end;
$$;

do $$
begin
  perform pg_temp.assert(
    (select public.search_page_size(1000)) = 50,
    'the page size is capped');

  perform pg_temp.assert(
    (select public.search_page_size(0)) = 1,
    'a zero page size is raised to one');

  perform pg_temp.assert(
    (select public.search_page_size(null)) = 20,
    'a missing page size falls back to the default');

  perform pg_temp.assert(
    (select public.search_page_size(-5)) = 1,
    'a negative page size is raised to one');

  perform pg_temp.assert(
    (select public.search_page_offset(-5)) = 0,
    'a negative offset is clamped to zero');

  perform pg_temp.assert(
    (select public.search_page_offset(null)) = 0,
    'a missing offset defaults to zero');

  perform pg_temp.assert(
    (select public.search_page_offset(999999)) = 10000,
    'the offset is bounded');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants(null, null, null, null, false, 'Rating', 1000, 0)) = 4,
    'an oversized limit still returns at most the capped page');
end;
$$;

do $$
declare
  v_restaurant uuid;
  v_category_b uuid;
  v_category_asian uuid;
begin
  select id into v_restaurant from t_search_ids where key = 'sushi';
  select id into v_category_asian from t_search_ids where key = 'category_asian';

  insert into public.categories (name, sort_order) values ('Late night', 2);
  select id into v_category_b from public.categories where name = 'Late night';

  insert into public.restaurant_categories (restaurant_id, category_id)
  values (v_restaurant, v_category_b);

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants(null, v_category_asian, null, null, false, 'Rating', 50, 0)
      where id = v_restaurant) = 1,
    'a restaurant in several categories is returned once');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants(null, null, null, null, false, 'Rating', 50, 0)) = 4,
    'an unfiltered search is not inflated by category rows');
end;
$$;

do $$
declare v_id uuid;
begin
  insert into public.restaurants (name, description, cuisines, tags)
  values ('Taco Stand', 'Street tacos', array['Mexican'], array['New'])
  returning id into v_id;

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants('taco', null, null, null, false, 'Recommended', 50, 0)) = 1,
    'a newly inserted restaurant is searchable immediately');

  update public.restaurants set name = 'Burrito Stand' where id = v_id;

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants('burrito', null, null, null, false, 'Recommended', 50, 0)) = 1,
    'renaming a restaurant updates the search document');

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants('taco', null, null, null, false, 'Recommended', 50, 0)) = 0,
    'the stale name no longer matches');

  update public.restaurants set cuisines = array['Mexican','Vegan'] where id = v_id;

  perform pg_temp.assert(
    (select count(*) from public.search_restaurants(null, null, array['Vegan'], null, false, 'Recommended', 50, 0)) = 2,
    'changing cuisines updates the filterable column');

  delete from public.restaurants where id = v_id;

  perform pg_temp.assert(
    not exists (select 1 from public.restaurant_search where restaurant_id = v_id),
    'deleting a restaurant removes its search document');
end;
$$;

do $$
declare v_count int;
begin
  perform pg_temp.assert(
    (select count(*) from public.search_restaurants_in_bounds(
      51.0, 7.0, 52.0, 8.0, null, null, false, 'Rating', 50)) = 0,
    'restaurants without coordinates never appear in a map viewport');

  update public.restaurants set latitude = 51.9625, longitude = 7.6257
   where id = (select id from t_search_ids where key = 'sushi');
  update public.restaurants set latitude = 48.1351, longitude = 11.5820
   where id = (select id from t_search_ids where key = 'pizza');

  select count(*) into v_count from public.search_restaurants_in_bounds(
    51.0, 7.0, 52.0, 8.0, null, null, false, 'Rating', 50);
  perform pg_temp.assert(v_count = 1, 'the viewport query returns only restaurants inside the box');

  select count(*) into v_count from public.search_restaurants_in_bounds(
    52.0, 8.0, 51.0, 7.0, null, null, false, 'Rating', 50);
  perform pg_temp.assert(v_count = 1, 'reversed viewport corners are normalised');

  select count(*) into v_count from public.search_restaurants_in_bounds(
    51.0, 7.0, 52.0, 8.0, array['Italian'], null, false, 'Rating', 50);
  perform pg_temp.assert(v_count = 0, 'viewport results still honour the cuisine filter');
end;
$$;

do $$
declare v_anon_dishes int;
begin
  set local role anon;
  select count(*) into v_anon_dishes from public.search_dishes('nigiri', 50, 0);
  perform pg_temp.assert(v_anon_dishes = 1, 'anonymous visitors can search dishes');
  perform pg_temp.assert(
    (select count(*) from public.restaurant_search) > 0,
    'the search document table is readable for the public catalogue');
  reset role;
end;
$$;

rollback;
