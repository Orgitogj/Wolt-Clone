drop policy if exists "read own courier" on public.couriers;
create policy "read own courier" on public.couriers
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "read own courier documents" on public.courier_documents;
create policy "read own courier documents" on public.courier_documents
  for select using (courier_id = auth.uid() or public.is_admin());

drop policy if exists "upload own courier documents" on public.courier_documents;
create policy "upload own courier documents" on public.courier_documents
  for insert with check (courier_id = auth.uid());

drop policy if exists "read deliveries" on public.deliveries;
create policy "read deliveries" on public.deliveries
  for select using (
    courier_id = auth.uid()
    or public.is_admin()
    or public.manages_restaurant(restaurant_id)
    or exists (
      select 1 from public.orders o
       where o.id = order_id and o.user_id = auth.uid()
    )
    or exists (
      select 1 from public.delivery_offers f
       where f.delivery_id = deliveries.id
         and f.courier_id = auth.uid()
         and f.status = 'pending'
         and f.expires_at > now()
    )
  );

drop policy if exists "read own delivery offers" on public.delivery_offers;
create policy "read own delivery offers" on public.delivery_offers
  for select using (courier_id = auth.uid() or public.is_admin());

drop policy if exists "read own earnings" on public.courier_earnings;
create policy "read own earnings" on public.courier_earnings
  for select using (courier_id = auth.uid() or public.is_admin());

create or replace view public.delivery_couriers as
select c.id,
       c.full_name,
       c.vehicle_type,
       c.current_latitude,
       c.current_longitude,
       c.location_updated_at,
       d.id as delivery_id,
       d.order_id
  from public.couriers c
  join public.deliveries d on d.courier_id = c.id
 where d.status in ('assigned', 'picked_up', 'delivering')
   and (
     public.is_admin()
     or public.manages_restaurant(d.restaurant_id)
     or exists (
       select 1 from public.orders o
        where o.id = d.order_id and o.user_id = auth.uid()
     )
   );

revoke all on public.delivery_couriers from public, anon;
grant select on public.delivery_couriers to authenticated;

insert into storage.buckets (id, name, public)
values ('courier-documents', 'courier-documents', false)
on conflict (id) do nothing;

drop policy if exists "courier uploads own documents" on storage.objects;
create policy "courier uploads own documents" on storage.objects
  for insert with check (
    bucket_id = 'courier-documents'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "courier reads own documents" on storage.objects;
create policy "courier reads own documents" on storage.objects
  for select using (
    bucket_id = 'courier-documents'
    and (split_part(name, '/', 1) = auth.uid()::text or public.is_admin())
  );
