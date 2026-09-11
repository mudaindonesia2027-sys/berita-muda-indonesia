-- MUDA Indonesia V17 — Owner Money Intelligence
-- Business finance control-plane. Internal bookkeeping only; not a public wallet.
create extension if not exists pgcrypto;

create table if not exists public.owner_cost_centers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null default 'operating' check (kind in ('operating','content','marketing','sales','technology','people','tax','capital','other')),
  active boolean not null default true,
  monthly_budget numeric(20,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.owner_expenses (
  id uuid primary key default gen_random_uuid(),
  cost_center_id uuid references public.owner_cost_centers(id) on delete set null,
  category text not null default 'other' check (category in ('content','marketing','sales','technology','people','operations','tax','capital','fee','other')),
  vendor text,
  description text,
  amount numeric(20,2) not null check (amount > 0),
  currency text not null default 'IDR',
  status text not null default 'planned' check (status in ('planned','approved','paid','cancelled')),
  due_at timestamptz,
  paid_at timestamptz,
  recurring boolean not null default false,
  recurrence_rule text,
  external_reference text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_expenses_due_idx on public.owner_expenses(status, due_at);
create index if not exists owner_expenses_center_idx on public.owner_expenses(cost_center_id, created_at desc);

create table if not exists public.owner_budgets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cost_center_id uuid references public.owner_cost_centers(id) on delete set null,
  period_start date not null,
  period_end date not null,
  amount numeric(20,2) not null check (amount >= 0),
  spent numeric(20,2) not null default 0,
  status text not null default 'active' check (status in ('draft','active','closed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create index if not exists owner_budgets_period_idx on public.owner_budgets(period_start, period_end, status);

create table if not exists public.owner_capital_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('injection','withdrawal','loan_in','loan_out','owner_contribution','owner_draw','other')),
  counterparty text,
  amount numeric(20,2) not null check (amount > 0),
  currency text not null default 'IDR',
  occurred_at timestamptz not null default now(),
  notes text,
  external_reference text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists owner_capital_time_idx on public.owner_capital_events(occurred_at desc);

create table if not exists public.owner_money_goals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  metric text not null check (metric in ('monthly_revenue','monthly_profit','cash_buffer','runway_months','ad_revenue','affiliate_revenue','sponsor_revenue','expense_reduction','other')),
  target_value numeric(20,2) not null,
  period_end date,
  status text not null default 'active' check (status in ('draft','active','achieved','paused','closed')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace view public.owner_money_snapshot as
select
  coalesce((select sum(amount) from public.revenue_entries where occurred_at >= now() - interval '30 days'),0) as revenue_30d,
  coalesce((select sum(amount) from public.revenue_entries where occurred_at >= now() - interval '7 days'),0) as revenue_7d,
  coalesce((select sum(amount) from public.revenue_entries where occurred_at >= now() - interval '1 day'),0) as revenue_1d,
  coalesce((select sum(amount) from public.owner_expenses where status in ('approved','paid') and coalesce(paid_at,created_at) >= now() - interval '30 days'),0) as expenses_30d,
  coalesce((select sum(amount) from public.owner_expenses where status in ('planned','approved') and coalesce(due_at,created_at) <= now() + interval '30 days'),0) as upcoming_expenses_30d,
  coalesce((select sum(available_balance) from public.wallet_accounts where status='active'),0) as available_cash,
  coalesce((select sum(pending_balance) from public.wallet_accounts where status='active'),0) as pending_cash,
  coalesce((select sum(amount) from public.owner_capital_events where event_type in ('injection','loan_in','owner_contribution')),0) as capital_in_ever,
  coalesce((select sum(amount) from public.owner_capital_events where event_type in ('withdrawal','loan_out','owner_draw')),0) as capital_out_ever;

alter table public.owner_cost_centers enable row level security;
alter table public.owner_expenses enable row level security;
alter table public.owner_budgets enable row level security;
alter table public.owner_capital_events enable row level security;
alter table public.owner_money_goals enable row level security;
revoke all on public.owner_cost_centers, public.owner_expenses, public.owner_budgets, public.owner_capital_events, public.owner_money_goals from anon, authenticated;
grant all on public.owner_cost_centers, public.owner_expenses, public.owner_budgets, public.owner_capital_events, public.owner_money_goals to service_role;
revoke all on public.owner_money_snapshot from anon, authenticated;
grant select on public.owner_money_snapshot to service_role;

insert into public.owner_cost_centers(name,kind,monthly_budget)
values
 ('Editorial','content',0),
 ('Marketing','marketing',0),
 ('Technology','technology',0),
 ('Operations','operations',0),
 ('People','people',0),
 ('Sales & Partnerships','sales',0),
 ('Tax & Compliance','tax',0),
 ('Capital','capital',0)
on conflict (name) do nothing;
