drop policy if exists "own profile" on public.profiles;
drop policy if exists "update own profile" on public.profiles;
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id or public.is_admin());
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own addresses" on public.addresses;
create policy "own addresses" on public.addresses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "admin read addresses" on public.addresses;
create policy "admin read addresses" on public.addresses
  for select using (public.is_admin());

drop policy if exists "restaurant reads delivery address" on public.addresses;
create policy "restaurant reads delivery address" on public.addresses
  for select using (
    exists (
      select 1 from public.orders o
       where o.address_id = addresses.id
         and public.manages_restaurant(o.restaurant_id)
    )
  );

drop policy if exists "own favorites" on public.favorites;
create policy "own favorites" on public.favorites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "public read categories" on public.categories;
create policy "public read categories" on public.categories for select using (true);
drop policy if exists "admin write categories" on public.categories;
create policy "admin write categories" on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "public read restaurants" on public.restaurants;
create policy "public read restaurants" on public.restaurants for select using (true);
drop policy if exists "manage own restaurant" on public.restaurants;
create policy "manage own restaurant" on public.restaurants
  for update using (public.manages_restaurant(id)) with check (public.manages_restaurant(id));
drop policy if exists "admin create restaurants" on public.restaurants;
create policy "admin create restaurants" on public.restaurants
  for insert with check (public.is_admin());
drop policy if exists "admin delete restaurants" on public.restaurants;
create policy "admin delete restaurants" on public.restaurants
  for delete using (public.is_admin());

drop policy if exists "public read restaurant_categories" on public.restaurant_categories;
create policy "public read restaurant_categories" on public.restaurant_categories
  for select using (true);
drop policy if exists "manage restaurant_categories" on public.restaurant_categories;
create policy "manage restaurant_categories" on public.restaurant_categories
  for all using (public.manages_restaurant(restaurant_id))
  with check (public.manages_restaurant(restaurant_id));

drop policy if exists "public read menu_categories" on public.menu_categories;
create policy "public read menu_categories" on public.menu_categories for select using (true);
drop policy if exists "manage menu_categories" on public.menu_categories;
create policy "manage menu_categories" on public.menu_categories
  for all using (public.manages_restaurant(restaurant_id))
  with check (public.manages_restaurant(restaurant_id));

drop policy if exists "public read dishes" on public.dishes;
create policy "public read dishes" on public.dishes for select using (true);
drop policy if exists "manage dishes" on public.dishes;
create policy "manage dishes" on public.dishes
  for all using (public.manages_restaurant(restaurant_id))
  with check (public.manages_restaurant(restaurant_id));

drop policy if exists "public read dish_addons" on public.dish_addons;
create policy "public read dish_addons" on public.dish_addons for select using (true);
drop policy if exists "manage dish_addons" on public.dish_addons;
create policy "manage dish_addons" on public.dish_addons
  for all using (
    exists (
      select 1 from public.dishes d
       where d.id = dish_id and public.manages_restaurant(d.restaurant_id)
    )
  )
  with check (
    exists (
      select 1 from public.dishes d
       where d.id = dish_id and public.manages_restaurant(d.restaurant_id)
    )
  );

drop policy if exists "public read restaurant_hours" on public.restaurant_hours;
create policy "public read restaurant_hours" on public.restaurant_hours for select using (true);
drop policy if exists "manage restaurant_hours" on public.restaurant_hours;
create policy "manage restaurant_hours" on public.restaurant_hours
  for all using (public.manages_restaurant(restaurant_id))
  with check (public.manages_restaurant(restaurant_id));

drop policy if exists "public read platform_settings" on public.platform_settings;
create policy "public read platform_settings" on public.platform_settings for select using (true);

drop policy if exists "read order_status_transitions" on public.order_status_transitions;
create policy "read order_status_transitions" on public.order_status_transitions
  for select using (true);

drop policy if exists "read restaurant_members" on public.restaurant_members;
create policy "read restaurant_members" on public.restaurant_members
  for select using (user_id = auth.uid() or public.manages_restaurant(restaurant_id));

drop policy if exists "own orders" on public.orders;
drop policy if exists "read own orders" on public.orders;
drop policy if exists "read orders" on public.orders;
create policy "read orders" on public.orders
  for select using (
    auth.uid() = user_id
    or public.manages_restaurant(restaurant_id)
  );

drop policy if exists "own order_items" on public.order_items;
drop policy if exists "read own order_items" on public.order_items;
drop policy if exists "read order_items" on public.order_items;
create policy "read order_items" on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
       where o.id = order_id
         and (o.user_id = auth.uid() or public.manages_restaurant(o.restaurant_id))
    )
  );

drop policy if exists "read order_status_history" on public.order_status_history;
create policy "read order_status_history" on public.order_status_history
  for select using (
    exists (
      select 1 from public.orders o
       where o.id = order_id
         and (o.user_id = auth.uid() or public.manages_restaurant(o.restaurant_id))
    )
  );

drop policy if exists "public read app-images" on storage.objects;
create policy "public read app-images" on storage.objects
  for select using (bucket_id = 'app-images');
