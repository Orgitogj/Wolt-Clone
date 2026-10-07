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

create temporary table t_rev (key text primary key, id uuid not null) on commit drop;
grant all on t_rev to anon, authenticated;

insert into auth.users (id, email)
values
  (gen_random_uuid(), 'rev-customer@test.local'),
  (gen_random_uuid(), 'rev-other@test.local'),
  (gen_random_uuid(), 'rev-merchant@test.local'),
  (gen_random_uuid(), 'rev-admin@test.local');

insert into t_rev (key, id)
select 'customer', id from auth.users where email = 'rev-customer@test.local'
union all select 'other', id from auth.users where email = 'rev-other@test.local'
union all select 'merchant', id from auth.users where email = 'rev-merchant@test.local'
union all select 'admin', id from auth.users where email = 'rev-admin@test.local';

update public.profiles set role = 'admin' where id = (select id from t_rev where key = 'admin');
update public.profiles set full_name = 'Ada Lovelace'
 where id = (select id from t_rev where key = 'customer');

insert into public.restaurants (name, min_order, is_open, latitude, longitude, rating, review_count)
values ('Review Kitchen', 0, true, 51.9625, 7.6257, 4.0, 10);
insert into t_rev (key, id) select 'restaurant', id from public.restaurants where name = 'Review Kitchen';

insert into public.restaurant_members (restaurant_id, user_id, role)
select r.id, m.id, 'owner' from t_rev r, t_rev m where r.key = 'restaurant' and m.key = 'merchant';

insert into public.menu_categories (restaurant_id, name)
select id, 'Mains' from t_rev where key = 'restaurant';

insert into public.dishes (restaurant_id, menu_category_id, name, price, is_available)
select r.id, m.id, 'Review Dish', 10.00, true
  from t_rev r join public.menu_categories m on m.restaurant_id = r.id
 where r.key = 'restaurant';
insert into t_rev (key, id) select 'dish', id from public.dishes where name = 'Review Dish';

insert into public.addresses (user_id, label, address_line, latitude, longitude)
select id, 'Home', 'Reviewweg 1', 51.9650, 7.6300 from t_rev where key = 'customer';
insert into t_rev (key, id) select 'address', id from public.addresses where address_line = 'Reviewweg 1';

do $$
declare
  v_order public.orders;
  v_second public.orders;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'customer'));

  v_order := public.create_order(
    (select id from t_rev where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object(
      'dish_id', (select id from t_rev where key = 'dish'), 'quantity', 1, 'addon_ids', '[]'::jsonb)),
    'delivery', (select id from t_rev where key = 'address'), null, 0, 'cash', false, false,
    gen_random_uuid());
  insert into t_rev (key, id) values ('order', v_order.id);

  v_second := public.create_order(
    (select id from t_rev where key = 'restaurant'),
    jsonb_build_array(jsonb_build_object(
      'dish_id', (select id from t_rev where key = 'dish'), 'quantity', 1, 'addon_ids', '[]'::jsonb)),
    'delivery', (select id from t_rev where key = 'address'), null, 0, 'cash', false, false,
    gen_random_uuid());
  insert into t_rev (key, id) values ('open_order', v_second.id);
end;
$$;

do $$
declare v_can boolean; v_reason text;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'customer'));

  select can_review, reason into v_can, v_reason
    from public.review_eligibility((select id from t_rev where key = 'order'));
  perform pg_temp.assert(v_can = false and v_reason = 'not_delivered',
    'an undelivered order is not reviewable');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'customer'));
  begin
    perform public.submit_review((select id from t_rev where key = 'order'), 5, 'Too early');
  exception when others then
    v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a review is rejected before the order is delivered');
end;
$$;

do $$
declare v_order_id uuid;
begin
  v_order_id := (select id from t_rev where key = 'order');
  perform pg_temp.act_as((select id from t_rev where key = 'merchant'));
  perform public.transition_order_status(v_order_id, 'accepted'::public.order_status);
  perform public.transition_order_status(v_order_id, 'preparing'::public.order_status);
  perform public.transition_order_status(v_order_id, 'ready_for_pickup'::public.order_status);
  perform public.transition_order_status(v_order_id, 'delivered'::public.order_status);
end;
$$;

do $$
declare v_can boolean; v_reason text;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'customer'));
  select can_review, reason into v_can, v_reason
    from public.review_eligibility((select id from t_rev where key = 'order'));
  perform pg_temp.assert(v_can and v_reason = 'eligible',
    'a delivered order becomes reviewable by its customer');
end;
$$;

do $$
declare v_can boolean; v_reason text;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'other'));
  select can_review, reason into v_can, v_reason
    from public.review_eligibility((select id from t_rev where key = 'order'));
  perform pg_temp.assert(v_can = false and v_reason = 'not_your_order',
    'another customer cannot review someone else''s order');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'other'));
  begin
    perform public.submit_review((select id from t_rev where key = 'order'), 1, 'Not mine');
  exception when others then
    v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'submitting a review for another customer''s order is refused');
end;
$$;

do $$
declare v_review public.reviews;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'customer'));
  v_review := public.submit_review((select id from t_rev where key = 'order'), 5, '  Lovely food  ');
  insert into t_rev (key, id) values ('review', v_review.id);

  perform pg_temp.assert(v_review.rating = 5, 'the rating is stored');
  perform pg_temp.assert(v_review.body = 'Lovely food', 'review text is trimmed');
  perform pg_temp.assert(v_review.status = 'visible', 'a new review starts visible');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'customer'));
  begin
    perform public.submit_review((select id from t_rev where key = 'order'), 4, 'Second try');
  exception when others then
    v_failed := true;
  end;
  perform pg_temp.assert(v_failed, 'a second review for the same order is refused');
end;
$$;

do $$
declare v_failed boolean;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'customer'));

  v_failed := false;
  begin
    perform public.submit_review((select id from t_rev where key = 'open_order'), 0, null);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a rating below one is refused');

  v_failed := false;
  begin
    perform public.submit_review((select id from t_rev where key = 'open_order'), 6, null);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a rating above five is refused');

  v_failed := false;
  begin
    perform public.update_review((select id from t_rev where key = 'review'), 3, repeat('x', 1001));
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'over long review text is refused');
end;
$$;

do $$
declare v_rating numeric; v_count int;
begin
  select rating, review_count into v_rating, v_count
    from public.restaurants where id = (select id from t_rev where key = 'restaurant');
  perform pg_temp.assert(v_rating = 5.0, 'the restaurant aggregate follows the review');
  perform pg_temp.assert(v_count = 1, 'the review count follows the review');
end;
$$;

do $$
declare v_review public.reviews; v_rating numeric;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'customer'));
  v_review := public.update_review((select id from t_rev where key = 'review'), 3, 'Changed my mind');
  perform pg_temp.assert(v_review.rating = 3, 'a customer can edit their own review');

  select rating into v_rating from public.restaurants
   where id = (select id from t_rev where key = 'restaurant');
  perform pg_temp.assert(v_rating = 3.0, 'editing a review updates the aggregate');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'other'));
  begin
    perform public.update_review((select id from t_rev where key = 'review'), 1, 'Sabotage');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'another customer cannot edit a review');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'merchant'));
  begin
    perform public.update_review((select id from t_rev where key = 'review'), 5, 'Nice to us');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a merchant cannot edit a customer review');
end;
$$;

do $$
declare v_failed boolean := false;
begin
  set local role authenticated;
  perform pg_temp.act_as((select id from t_rev where key = 'merchant'));
  begin
    update public.restaurants set rating = 5.0, review_count = 999
     where id = (select id from t_rev where key = 'restaurant');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a merchant cannot overwrite the aggregate rating directly');
  reset role;
end;
$$;

do $$
declare v_failed boolean := false;
begin
  set local role authenticated;
  perform pg_temp.act_as((select id from t_rev where key = 'customer'));
  begin
    insert into public.reviews (order_id, restaurant_id, user_id, rating)
    values ((select id from t_rev where key = 'open_order'),
            (select id from t_rev where key = 'restaurant'),
            (select id from t_rev where key = 'customer'), 5);
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'reviews cannot be inserted directly by a client');
  reset role;
end;
$$;

do $$
declare v_response public.review_responses; v_failed boolean := false;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'other'));
  begin
    perform public.respond_to_review((select id from t_rev where key = 'review'), 'Not my restaurant');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a stranger cannot respond to a review');

  perform pg_temp.act_as((select id from t_rev where key = 'merchant'));
  v_response := public.respond_to_review((select id from t_rev where key = 'review'), 'Thank you!');
  perform pg_temp.assert(v_response.body = 'Thank you!', 'the restaurant can respond to its review');

  v_response := public.respond_to_review((select id from t_rev where key = 'review'), 'Updated reply');
  perform pg_temp.assert(v_response.body = 'Updated reply', 'responding again replaces the response');

  perform pg_temp.assert(
    (select count(*) from public.review_responses
      where review_id = (select id from t_rev where key = 'review')) = 1,
    'a review has at most one response');
end;
$$;

do $$
declare v_rows int;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'customer'));
  select count(*) into v_rows
    from public.restaurant_reviews((select id from t_rev where key = 'restaurant'), 20, 0);
  perform pg_temp.assert(v_rows = 1, 'the public review list returns the visible review');

  perform pg_temp.assert(
    (select reviewer_name from public.restaurant_reviews(
      (select id from t_rev where key = 'restaurant'), 20, 0)) = 'Ada',
    'only the reviewer first name is exposed');

  perform pg_temp.assert(
    (select response_body from public.restaurant_reviews(
      (select id from t_rev where key = 'restaurant'), 20, 0)) = 'Updated reply',
    'the restaurant response is returned with the review');

  perform pg_temp.assert(
    (select is_mine from public.restaurant_reviews(
      (select id from t_rev where key = 'restaurant'), 20, 0)) = true,
    'a customer sees which review is theirs');
end;
$$;

do $$
declare v_failed boolean := false; v_review public.reviews;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'merchant'));
  begin
    perform public.moderate_review((select id from t_rev where key = 'review'), 'hidden', 'Spam');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a merchant cannot moderate reviews');

  perform pg_temp.act_as((select id from t_rev where key = 'admin'));
  v_review := public.moderate_review((select id from t_rev where key = 'review'), 'hidden', 'Spam');
  perform pg_temp.assert(v_review.status = 'hidden', 'an admin can hide a review');
  perform pg_temp.assert(v_review.moderation_reason = 'Spam', 'the moderation reason is recorded');

  perform pg_temp.assert(
    (select count(*) from public.admin_actions
      where action = 'moderate_review'
        and subject_id = (select id::text from t_rev where key = 'review')) = 1,
    'moderation is written to the admin audit log');
end;
$$;

do $$
declare v_rows int; v_count int;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'customer'));
  select count(*) into v_rows
    from public.restaurant_reviews((select id from t_rev where key = 'restaurant'), 20, 0);
  perform pg_temp.assert(v_rows = 0, 'a hidden review disappears from the public list');

  select review_count into v_count
    from public.restaurant_review_summary((select id from t_rev where key = 'restaurant'));
  perform pg_temp.assert(v_count = 0, 'a hidden review is excluded from the summary');
end;
$$;

do $$
declare v_rows int;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'customer'));
  select count(*) into v_rows from public.my_reviews(20, 0);
  perform pg_temp.assert(v_rows = 1, 'a customer still sees their own moderated review');

  perform pg_temp.act_as((select id from t_rev where key = 'other'));
  select count(*) into v_rows from public.my_reviews(20, 0);
  perform pg_temp.assert(v_rows = 0, 'a customer never sees another customer review list');
end;
$$;

do $$
declare v_review public.reviews; v_rows int;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'admin'));
  perform public.moderate_review((select id from t_rev where key = 'review'), 'visible', null);

  perform pg_temp.act_as((select id from t_rev where key = 'customer'));
  select count(*) into v_rows
    from public.restaurant_reviews((select id from t_rev where key = 'restaurant'), 20, 0);
  perform pg_temp.assert(v_rows = 1, 'restoring a review brings it back');

  v_review := public.delete_review((select id from t_rev where key = 'review'));
  perform pg_temp.assert(v_review.id is not null, 'a customer can delete their own review');

  select count(*) into v_rows
    from public.restaurant_reviews((select id from t_rev where key = 'restaurant'), 20, 0);
  perform pg_temp.assert(v_rows = 0, 'a deleted review leaves the public list');

  perform pg_temp.assert(
    not exists (select 1 from public.review_responses
                 where review_id = (select id from t_rev where key = 'review')),
    'deleting a review removes its response');
end;
$$;

do $$
declare v_can boolean; v_reason text;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'customer'));
  select can_review, reason into v_can, v_reason
    from public.review_eligibility((select id from t_rev where key = 'order'));
  perform pg_temp.assert(v_can and v_reason = 'eligible',
    'deleting a review makes the order reviewable again');
end;
$$;

do $$
declare v_count int;
begin
  set local role anon;
  select count(*) into v_count
    from public.restaurant_reviews((select id from t_rev where key = 'restaurant'), 20, 0);
  perform pg_temp.assert(v_count = 0, 'anonymous visitors can read the public review list');
  reset role;
end;
$$;


do $$
declare v_rows int;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'merchant'));
  select count(*) into v_rows from public.manage_reviews(
    (select id from t_rev where key = 'restaurant'), 20, 0);
  perform pg_temp.assert(v_rows >= 0, 'a merchant can list reviews for their own restaurant');

  perform pg_temp.act_as((select id from t_rev where key = 'other'));
  select count(*) into v_rows from public.manage_reviews(
    (select id from t_rev where key = 'restaurant'), 20, 0);
  perform pg_temp.assert(v_rows = 0, 'a stranger sees no reviews in the management list');

  perform pg_temp.act_as((select id from t_rev where key = 'admin'));
  select count(*) into v_rows from public.manage_reviews(null, 20, 0);
  perform pg_temp.assert(v_rows >= 0, 'an admin can list reviews across restaurants');
end;
$$;


do $$
declare v_name text; v_failed boolean := false;
begin
  set local role authenticated;
  perform pg_temp.act_as((select id from t_rev where key = 'merchant'));

  update public.restaurants
     set name = 'Review Kitchen Renamed',
         description = 'Now with more tests',
         delivery_fee = 2.50
   where id = (select id from t_rev where key = 'restaurant');

  select name into v_name from public.restaurants
   where id = (select id from t_rev where key = 'restaurant');
  perform pg_temp.assert(v_name = 'Review Kitchen Renamed',
    'the rating guard still lets a merchant edit their own restaurant');

  perform pg_temp.assert(
    exists (
      select 1 from public.restaurant_search s
       where s.restaurant_id = (select id from t_rev where key = 'restaurant')
         and s.document @@ websearch_to_tsquery('simple', 'Renamed')
    ),
    'renaming through a merchant update still refreshes the search document');

  begin
    update public.restaurants set review_count = 500
     where id = (select id from t_rev where key = 'restaurant');
  exception when others then v_failed := true; end;
  perform pg_temp.assert(v_failed, 'a merchant still cannot set the review count');

  reset role;
end;
$$;

do $$
declare v_rating numeric;
begin
  perform pg_temp.act_as((select id from t_rev where key = 'admin'));

  update public.restaurants set rating = 4.2
   where id = (select id from t_rev where key = 'restaurant');

  select rating into v_rating from public.restaurants
   where id = (select id from t_rev where key = 'restaurant');
  perform pg_temp.assert(v_rating = 4.2, 'an admin can still correct a rating by hand');
end;
$$;

rollback;
