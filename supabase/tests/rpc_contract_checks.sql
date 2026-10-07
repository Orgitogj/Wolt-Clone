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

do $$
declare
  v_count int;
  v_args text;
  v_returns text;
  v_secdef boolean;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_order';
  perform pg_temp.assert(v_count = 1, 'exactly one create_order function exists');

  select pg_get_function_identity_arguments(p.oid),
         pg_get_function_result(p.oid),
         p.prosecdef
    into v_args, v_returns, v_secdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_order';

  perform pg_temp.assert(
    v_args = 'p_restaurant_id uuid, p_items jsonb, p_delivery_mode text, p_address_id uuid, '
          || 'p_scheduled_for timestamp with time zone, p_tip_amount numeric, p_payment_method text, '
          || 'p_leave_at_door boolean, p_send_as_gift boolean, p_idempotency_key uuid, p_promo_code text',
    'create_order keeps the parameter names and order the client sends');

  perform pg_temp.assert(v_returns = 'orders', 'create_order returns an orders row');
  perform pg_temp.assert(v_secdef, 'create_order runs with definer rights');

  perform pg_temp.assert(
    (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'create_order'
        and pronargdefaults = 8) = 1,
    'create_order keeps eight optional parameters');
end;
$$;

do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'create_order',
    'review_eligibility',
    'submit_review',
    'update_review',
    'delete_review',
    'respond_to_review',
    'moderate_review',
    'my_reviews',
    'manage_reviews',
    'restaurant_rating_sync',
    'evaluate_promotion',
    'admin_save_promotion',
    'admin_set_promotion_active',
    'admin_promotions',
    'promotion_redemption_state',
    'transition_order_status'
  ]
  loop
    perform pg_temp.assert(
      not exists (
        select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_fn
           and has_function_privilege('anon', p.oid, 'EXECUTE')
      ),
      format('%s is not callable by anonymous visitors', v_fn));

    perform pg_temp.assert(
      not exists (
        select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_fn
           and array_to_string(coalesce(p.proacl, '{}'::aclitem[])::text[], ' ') like '%=X/%'
           and array_to_string(coalesce(p.proacl, '{}'::aclitem[])::text[], ' ') ~ '(^| )=X/'
      ),
      format('%s does not keep the default PUBLIC execute grant', v_fn));
  end loop;
end;
$$;

do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'search_restaurants',
    'search_restaurants_in_bounds',
    'search_dishes',
    'distinct_cuisines',
    'restaurant_reviews',
    'restaurant_review_summary',
    'active_promotions'
  ]
  loop
    perform pg_temp.assert(
      exists (
        select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_fn
           and has_function_privilege('anon', p.oid, 'EXECUTE')
      ),
      format('%s stays readable for the public catalogue', v_fn));
  end loop;
end;
$$;

do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'create_order',
    'submit_review',
    'update_review',
    'delete_review',
    'respond_to_review',
    'moderate_review',
    'evaluate_promotion',
    'admin_save_promotion',
    'admin_set_promotion_active',
    'admin_promotions',
    'my_reviews',
    'manage_reviews',
    'review_eligibility'
  ]
  loop
    perform pg_temp.assert(
      exists (
        select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_fn
           and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      ),
      format('%s stays callable by a signed in customer', v_fn));
  end loop;
end;
$$;

do $$
begin
  perform pg_temp.assert(
    not exists (
      select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('submit_review', 'update_review', 'delete_review', 'moderate_review',
                           'respond_to_review', 'create_order', 'admin_save_promotion')
         and not p.prosecdef
    ),
    'every privileged write function runs with definer rights');

  perform pg_temp.assert(
    (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'evaluate_promotion') = 1,
    'evaluate_promotion has no overload');

  perform pg_temp.assert(
    (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'submit_review') = 1,
    'submit_review has no overload');
end;
$$;

do $$
declare v_col text;
begin
  foreach v_col in array array['promotion_id', 'promo_code', 'discount_amount', 'promotion_snapshot']
  loop
    perform pg_temp.assert(
      exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'orders' and column_name = v_col
      ),
      format('orders keeps the %s column the client reads', v_col));
  end loop;

  perform pg_temp.assert(
    (select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'discount_amount') = '0',
    'discount_amount defaults to zero for orders placed without a code');

  perform pg_temp.assert(
    not exists (
      select 1 from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'orders'
         and grantee in ('anon', 'authenticated')
         and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    ),
    'clients still hold no write grant on orders');

  perform pg_temp.assert(
    not exists (
      select 1 from information_schema.role_table_grants
       where table_schema = 'public' and table_name in ('reviews', 'promotions', 'promotion_redemptions')
         and grantee in ('anon', 'authenticated')
         and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    ),
    'clients hold no write grant on reviews, promotions or redemptions');
end;
$$;

do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'support_report_eligibility',
    'submit_support_ticket',
    'send_support_message',
    'support_messages_page',
    'my_support_tickets',
    'support_ticket_details',
    'support_ticket_reported_items',
    'support_refunds_for_ticket',
    'order_refund_summary',
    'mark_support_messages_read',
    'support_unread_count',
    'admin_support_tickets',
    'admin_assign_support_ticket',
    'admin_set_support_status',
    'admin_approve_support_refund',
    'admin_confirm_cash_refund',
    'admin_retry_payment_reconciliation'
  ]
  loop
    perform pg_temp.assert(
      exists (
        select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_fn
      ),
      format('%s exists', v_fn));

    perform pg_temp.assert(
      not exists (
        select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_fn
           and has_function_privilege('anon', p.oid, 'EXECUTE')
      ),
      format('%s is not callable by anonymous visitors', v_fn));

    perform pg_temp.assert(
      not exists (
        select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_fn
           and array_to_string(coalesce(p.proacl, '{}'::aclitem[])::text[], ' ') ~ '(^| )=X/'
      ),
      format('%s does not keep the default PUBLIC execute grant', v_fn));

    perform pg_temp.assert(
      exists (
        select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_fn and p.prosecdef
      ),
      format('%s runs with definer rights', v_fn));

    perform pg_temp.assert(
      (select count(*) from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = v_fn) = 1,
      format('%s has no overload', v_fn));
  end loop;
end;
$$;

do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'support_report_eligibility',
    'submit_support_ticket',
    'send_support_message',
    'support_messages_page',
    'my_support_tickets',
    'support_ticket_details',
    'support_refunds_for_ticket',
    'order_refund_summary',
    'mark_support_messages_read',
    'support_unread_count'
  ]
  loop
    perform pg_temp.assert(
      exists (
        select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_fn
           and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      ),
      format('%s stays callable by a signed in customer', v_fn));
  end loop;
end;
$$;

do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'settle_support_refund',
    'post_ledger_delta',
    'record_refund',
    'resolve_payment_reconciliation',
    'fail_payment_reconciliation',
    'record_payment_reconciliation_outcome',
    'claim_payment_reconciliations'
  ]
  loop
    perform pg_temp.assert(
      not exists (
        select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_fn
           and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      ),
      format('%s is reachable only with service credentials', v_fn));

    perform pg_temp.assert(
      not exists (
        select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_fn
           and has_function_privilege('anon', p.oid, 'EXECUTE')
      ),
      format('%s is not callable by anonymous visitors', v_fn));
  end loop;
end;
$$;

do $$
declare v_args text; v_returns text;
begin
  perform pg_temp.assert(
    (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'claim_payment_reconciliations') = 1,
    'claim_payment_reconciliations has no overload');

  select pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid)
    into v_args, v_returns
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'claim_payment_reconciliations';

  perform pg_temp.assert(v_args = 'p_limit integer, p_lease_seconds integer',
    'the worker keeps the claim parameters it sends');

  foreach v_args in array array[
    'reconciliation_id uuid', 'kind text', 'amount numeric', 'payment_amount numeric',
    'provider_intent_id text', 'provider_idempotency_key uuid', 'attempts integer'
  ]
  loop
    perform pg_temp.assert(position(v_args in v_returns) > 0,
      format('a claimed job carries %s', v_args));
  end loop;
end;
$$;

do $$
declare v_args text;
begin
  select pg_get_function_identity_arguments(p.oid) into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_approve_support_refund';

  perform pg_temp.assert(
    v_args = 'p_ticket_id uuid, p_amount numeric, p_reason text, p_liability text, '
          || 'p_client_request_id uuid',
    'admin_approve_support_refund keeps the parameters the admin screen sends');

  select pg_get_function_identity_arguments(p.oid) into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'submit_support_ticket';

  perform pg_temp.assert(
    v_args = 'p_order_id uuid, p_client_ticket_id uuid, p_category text, p_description text, '
          || 'p_items jsonb',
    'submit_support_ticket keeps the parameters the report screen sends');
end;
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'support_tickets', 'support_ticket_items', 'support_messages', 'support_refunds',
    'support_message_reads'
  ]
  loop
    perform pg_temp.assert(
      (select relrowsecurity from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = v_table),
      format('%s enforces row level security', v_table));

    perform pg_temp.assert(
      not exists (
        select 1 from information_schema.role_table_grants
         where table_schema = 'public' and table_name = v_table
           and grantee in ('anon', 'authenticated')
           and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      ),
      format('%s is never written straight from a client', v_table));
  end loop;

  perform pg_temp.assert(
    exists (
      select 1 from pg_indexes
       where schemaname = 'public' and indexname = 'support_refunds_request_idx'
    ),
    'a repeated refund approval is stopped by a unique index');

  perform pg_temp.assert(
    exists (
      select 1 from pg_constraint c
        join pg_class t on t.oid = c.conrelid
       where t.relname = 'support_messages' and c.contype = 'u'
         and pg_get_constraintdef(c.oid) = 'UNIQUE (ticket_id, client_message_id)'
    ),
    'a repeated support message is stopped by a unique constraint');

  perform pg_temp.assert(
    exists (
      select 1 from pg_constraint c
        join pg_class t on t.oid = c.conrelid
       where t.relname = 'support_tickets' and c.contype = 'u'
         and pg_get_constraintdef(c.oid) = 'UNIQUE (user_id, client_ticket_id)'
    ),
    'a repeated report is stopped by a unique constraint');

  perform pg_temp.assert(
    exists (
      select 1 from pg_indexes
       where schemaname = 'public' and indexname = 'support_messages_page_idx'
    ),
    'the conversation is paginated from an index');
end;
$$;

rollback;
