-- MUDA Indonesia V18 — Owner Finance Administration Layer
-- Internal owner bookkeeping/control plane. No public wallet / payment processing.
create extension if not exists pgcrypto;

create table if not exists public.owner_money_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  account_type text not null default 'cash' check (account_type in ('cash','bank','wallet','receivable','payable','capital','ads','other')),
  currency text not null default 'IDR',
  opening_balance numeric(20,2) not null default 0,
  active boolean not null default true,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.owner_money_ledger (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('inflow','outflow')),
  entry_type text not null default 'other',
  source text,
  category text,
  account_id uuid references public.owner_money_accounts(id) on delete set null,
  cost_center_id uuid references public.owner_cost_centers(id) on delete set null,
  counterparty text,
  description text,
  amount numeric(20,2) not null check (amount > 0),
  tax_amount numeric(20,2) not null default 0 check (tax_amount >= 0),
  currency text not null default 'IDR',
  status text not null default 'planned' check (status in ('draft','planned','approved','settled','void')),
  occurred_at timestamptz not null default now(),
  due_at timestamptz,
  settled_at timestamptz,
  recurring boolean not null default false,
  recurrence_rule text,
  external_reference text,
  source_record_type text,
  source_record_id uuid,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_money_ledger_time_idx on public.owner_money_ledger(occurred_at desc);
create index if not exists owner_money_ledger_status_due_idx on public.owner_money_ledger(status, due_at);
create index if not exists owner_money_ledger_type_idx on public.owner_money_ledger(direction, entry_type, category);

create table if not exists public.owner_money_receivables (
  id uuid primary key default gen_random_uuid(),
  counterparty text,
  description text not null,
  source text,
  invoice_number text,
  amount numeric(20,2) not null check (amount > 0),
  currency text not null default 'IDR',
  issued_at date not null default current_date,
  due_at date,
  status text not null default 'open' check (status in ('draft','open','partial','paid','cancelled','overdue')),
  expected_at date,
  received_at date,
  external_reference text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_money_receivables_due_idx on public.owner_money_receivables(status,due_at);

create table if not exists public.owner_money_payables (
  id uuid primary key default gen_random_uuid(),
  counterparty text,
  description text not null,
  category text,
  invoice_number text,
  amount numeric(20,2) not null check (amount > 0),
  currency text not null default 'IDR',
  issued_at date not null default current_date,
  due_at date,
  status text not null default 'open' check (status in ('draft','open','partial','paid','cancelled','overdue')),
  expected_at date,
  paid_at date,
  external_reference text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_money_payables_due_idx on public.owner_money_payables(status,due_at);

create table if not exists public.owner_money_recurring_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  direction text not null check (direction in ('inflow','outflow')),
  entry_type text not null default 'other',
  source text,
  category text,
  amount numeric(20,2) not null check (amount > 0),
  currency text not null default 'IDR',
  frequency text not null default 'monthly' check (frequency in ('weekly','monthly','quarterly','yearly')),
  next_run date,
  active boolean not null default true,
  account_id uuid references public.owner_money_accounts(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.owner_money_monthly_closes (
  id uuid primary key default gen_random_uuid(),
  period_month date not null unique,
  status text not null default 'open' check (status in ('open','review','closed','reopened')),
  revenue numeric(20,2) not null default 0,
  expense numeric(20,2) not null default 0,
  net numeric(20,2) not null default 0,
  notes text,
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.owner_money_accounts enable row level security;
alter table public.owner_money_ledger enable row level security;
alter table public.owner_money_receivables enable row level security;
alter table public.owner_money_payables enable row level security;
alter table public.owner_money_recurring_rules enable row level security;
alter table public.owner_money_monthly_closes enable row level security;
revoke all on public.owner_money_accounts, public.owner_money_ledger, public.owner_money_receivables, public.owner_money_payables, public.owner_money_recurring_rules, public.owner_money_monthly_closes from anon, authenticated;
grant all on public.owner_money_accounts, public.owner_money_ledger, public.owner_money_receivables, public.owner_money_payables, public.owner_money_recurring_rules, public.owner_money_monthly_closes to service_role;

insert into public.owner_money_accounts(name,account_type,currency)
values ('Kas Operasional','cash','IDR'),('Bank Utama','bank','IDR'),('Wallet Internal','wallet','IDR'),('Piutang Iklan','receivable','IDR'),('Modal Owner','capital','IDR')
on conflict (name) do nothing;
