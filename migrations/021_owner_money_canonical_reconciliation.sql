-- MUDA Indonesia V19 — Canonical Money & Reconciliation Layer
-- Internal management ledger only. Not a bank, payment processor, or statutory accounting system.
create extension if not exists pgcrypto;

alter table public.owner_money_ledger
  add column if not exists canonical_key text,
  add column if not exists source_system text not null default 'owner_os',
  add column if not exists reconciled boolean not null default false,
  add column if not exists reconciliation_status text not null default 'unreconciled';

create unique index if not exists owner_money_ledger_canonical_key_uidx
  on public.owner_money_ledger(canonical_key)
  where canonical_key is not null;

create table if not exists public.owner_money_reconciliations (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  source_name text not null default 'owner_os',
  source_record_count integer not null default 0,
  canonical_record_count integer not null default 0,
  source_total_in numeric(20,2) not null default 0,
  source_total_out numeric(20,2) not null default 0,
  canonical_total_in numeric(20,2) not null default 0,
  canonical_total_out numeric(20,2) not null default 0,
  variance_in numeric(20,2) not null default 0,
  variance_out numeric(20,2) not null default 0,
  status text not null default 'review' check (status in ('review','matched','variance','closed')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_money_recon_period_idx
  on public.owner_money_reconciliations(period_start, period_end, status);

create table if not exists public.owner_finance_close_checks (
  id uuid primary key default gen_random_uuid(),
  period_month date not null,
  check_key text not null,
  label text not null,
  required boolean not null default true,
  passed boolean not null default false,
  value numeric(20,2),
  notes text,
  checked_at timestamptz,
  checked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(period_month, check_key)
);

insert into public.owner_finance_close_checks(period_month,check_key,label)
select date_trunc('month', current_date)::date, x.key, x.label
from (values
  ('unreconciled','Unreconciled money events'),
  ('overdue_receivable','Overdue receivables'),
  ('overdue_payable','Overdue payables'),
  ('budget_variance','Budget variance reviewed'),
  ('cash_review','Cash position reviewed'),
  ('revenue_review','Revenue attribution reviewed')
) x(key,label)
on conflict (period_month,check_key) do nothing;

alter table public.owner_money_reconciliations enable row level security;
alter table public.owner_finance_close_checks enable row level security;
revoke all on public.owner_money_reconciliations, public.owner_finance_close_checks from anon, authenticated;
grant all on public.owner_money_reconciliations, public.owner_finance_close_checks to service_role;
