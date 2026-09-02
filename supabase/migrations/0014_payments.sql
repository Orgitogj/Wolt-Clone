do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type public.payment_status as enum (
      'requires_payment', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'ledger_entry_type') then
    create type public.ledger_entry_type as enum (
      'charge', 'platform_commission', 'restaurant_payout', 'courier_payout', 'refund'
    );
  end if;
end
$$;

alter table public.platform_settings
  add column if not exists commission_rate numeric(5,4) not null default 0.1500
    check (commission_rate >= 0 and commission_rate < 1),
  add column if not exists card_payments_enabled boolean not null default false,
  add column if not exists payment_hold_minutes int not null default 20
    check (payment_hold_minutes > 0);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'stripe',
  provider_intent_id text unique,
  provider_charge_id text,
  status public.payment_status not null default 'requires_payment',
  amount numeric(10,2) not null check (amount >= 0),
  amount_refunded numeric(10,2) not null default 0 check (amount_refunded >= 0),
  currency text not null default 'EUR',
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_user_idx on public.payments (user_id, created_at desc);
create index if not exists payments_status_idx on public.payments (status);

alter table public.payments enable row level security;

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete cascade,
  provider_event_id text unique,
  event_type text not null,
  status public.payment_status not null,
  amount numeric(10,2) not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payment_transactions_payment_idx
  on public.payment_transactions (payment_id, created_at desc);

alter table public.payment_transactions enable row level security;

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  provider_refund_id text unique,
  amount numeric(10,2) not null check (amount > 0),
  reason text,
  requested_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists refunds_order_idx on public.refunds (order_id);

alter table public.refunds enable row level security;

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  entry_type public.ledger_entry_type not null,
  party_type text not null check (party_type in ('customer', 'restaurant', 'courier', 'platform')),
  party_id uuid,
  amount numeric(10,2) not null,
  currency text not null default 'EUR',
  memo text,
  created_at timestamptz not null default now()
);

create unique index if not exists ledger_entries_unique_idx
  on public.ledger_entries (
    order_id, entry_type, party_type,
    coalesce(party_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists ledger_entries_order_idx on public.ledger_entries (order_id);
create index if not exists ledger_entries_party_idx
  on public.ledger_entries (party_type, party_id, created_at desc);

alter table public.ledger_entries enable row level security;

create or replace view public.order_financials as
select o.id as order_id,
       o.restaurant_id,
       o.user_id,
       o.status,
       o.subtotal,
       o.service_fee,
       o.delivery_fee,
       o.tip_amount,
       o.total,
       coalesce(p.status::text, 'uncollected') as payment_status,
       coalesce(p.amount_refunded, 0) as amount_refunded,
       coalesce(sum(l.amount) filter (where l.entry_type = 'charge'), 0) as collected,
       coalesce(-sum(l.amount) filter (where l.entry_type = 'restaurant_payout'), 0) as restaurant_payout,
       coalesce(-sum(l.amount) filter (where l.entry_type = 'courier_payout'), 0) as courier_payout,
       coalesce(sum(l.amount) filter (where l.entry_type = 'platform_commission'), 0) as platform_commission,
       coalesce(sum(l.amount), 0) as platform_net
  from public.orders o
  left join public.payments p on p.order_id = o.id
  left join public.ledger_entries l on l.order_id = o.id
 where public.is_admin()
    or o.user_id = auth.uid()
    or public.manages_restaurant(o.restaurant_id)
 group by o.id, p.status, p.amount_refunded;

drop policy if exists "read own payments" on public.payments;
create policy "read own payments" on public.payments
  for select using (
    user_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.orders o
       where o.id = order_id and public.manages_restaurant(o.restaurant_id)
    )
  );

drop policy if exists "read payment transactions" on public.payment_transactions;
create policy "read payment transactions" on public.payment_transactions
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.payments p
       where p.id = payment_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "read own refunds" on public.refunds;
create policy "read own refunds" on public.refunds
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.orders o
       where o.id = order_id and o.user_id = auth.uid()
    )
    or exists (
      select 1 from public.orders o
       where o.id = order_id and public.manages_restaurant(o.restaurant_id)
    )
  );

drop policy if exists "read ledger entries" on public.ledger_entries;
create policy "read ledger entries" on public.ledger_entries
  for select using (
    public.is_admin()
    or (party_type = 'courier' and party_id = auth.uid())
    or (party_type = 'restaurant' and public.manages_restaurant(party_id))
    or (party_type = 'customer' and party_id = auth.uid())
  );

revoke all on public.order_financials from public, anon;
grant select on public.order_financials to authenticated;

revoke insert, update, delete on public.payments from anon, authenticated;
revoke insert, update, delete on public.payment_transactions from anon, authenticated;
revoke insert, update, delete on public.refunds from anon, authenticated;
revoke insert, update, delete on public.ledger_entries from anon, authenticated;
