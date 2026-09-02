do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'orders',
    'order_status_history',
    'deliveries',
    'delivery_offers',
    'courier_locations',
    'notifications'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end
$$;

alter table public.orders replica identity full;
alter table public.deliveries replica identity full;
alter table public.delivery_offers replica identity full;
alter table public.notifications replica identity full;
