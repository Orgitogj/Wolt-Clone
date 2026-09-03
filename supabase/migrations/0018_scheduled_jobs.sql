do $$
declare
  v_job record;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available: scheduled jobs were skipped, schedule them by hand';
    return;
  end if;

  execute 'create extension if not exists pg_cron';

  for v_job in
    select *
      from (values
        ('wolt-dispatch', '10 seconds', 'select public.advance_dispatch()'),
        ('wolt-expire-unpaid-orders', '* * * * *', 'select public.expire_unpaid_orders()'),
        ('wolt-prune-courier-locations', '30 3 * * *', 'select public.prune_courier_locations(30)')
      ) as j(name, schedule, command)
  loop
    if exists (select 1 from cron.job where jobname = v_job.name) then
      perform cron.unschedule(v_job.name);
    end if;

    perform cron.schedule(v_job.name, v_job.schedule, v_job.command);
  end loop;
end
$$;
