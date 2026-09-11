-- 011_wallet_and_monetization_upgrade.sql
-- MUDA Indonesia Business Wallet: internal bookkeeping / reconciliation wallet.
-- BUKAN dompet elektronik publik dan tidak menyimpan dana pengguna.

create extension if not exists pgcrypto;

create table if not exists public.wallet_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null default 'MUDA Indonesia Business Wallet',
  currency text not null default 'IDR',
  status text not null default 'active' check (status in ('active','suspended')),
  available_balance numeric(20,2) not null default 0 check (available_balance >= 0),
  pending_balance numeric(20,2) not null default 0 check (pending_balance >= 0),
  total_credits numeric(20,2) not null default 0,
  total_debits numeric(20,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_user_id, currency)
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallet_accounts(id) on delete cascade,
  direction text not null check (direction in ('credit','debit')),
  status text not null default 'available' check (status in ('pending','available','reversed')),
  amount numeric(20,2) not null check (amount > 0),
  currency text not null default 'IDR',
  source text not null default 'manual',
  provider text,
  external_reference text,
  category text not null default 'income' check (category in ('income','payout','expense','fee','adjustment','other')),
  description text,
  occurred_at timestamptz not null default now(),
  available_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists wallet_transactions_external_ref_uidx
  on public.wallet_transactions(wallet_id, provider, external_reference)
  where external_reference is not null;

create index if not exists wallet_transactions_wallet_time_idx
  on public.wallet_transactions(wallet_id, occurred_at desc);

create index if not exists wallet_transactions_source_idx
  on public.wallet_transactions(wallet_id, source, status);

create table if not exists public.wallet_payouts (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallet_accounts(id) on delete cascade,
  amount numeric(20,2) not null check (amount > 0),
  currency text not null default 'IDR',
  method text not null default 'manual_transfer',
  destination_label text,
  status text not null default 'requested' check (status in ('requested','approved','paid','rejected','cancelled')),
  notes text,
  external_reference text,
  transaction_id uuid references public.wallet_transactions(id) on delete set null,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists wallet_payouts_wallet_time_idx
  on public.wallet_payouts(wallet_id, requested_at desc);

alter table public.wallet_accounts enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.wallet_payouts enable row level security;

revoke all on table public.wallet_accounts from anon, authenticated;
revoke all on table public.wallet_transactions from anon, authenticated;
revoke all on table public.wallet_payouts from anon, authenticated;
grant all on table public.wallet_accounts to service_role;
grant all on table public.wallet_transactions to service_role;
grant all on table public.wallet_payouts to service_role;

drop function if exists public.wallet_post_transaction(uuid,text,numeric,text,text,text,text,text,text,timestamptz,timestamptz,jsonb,uuid);
create or replace function public.wallet_post_transaction(
  p_wallet_id uuid,
  p_direction text,
  p_amount numeric,
  p_status text default 'available',
  p_source text default 'manual',
  p_provider text default null,
  p_external_reference text default null,
  p_category text default 'income',
  p_description text default null,
  p_occurred_at timestamptz default now(),
  p_available_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb,
  p_created_by uuid default null
)
returns public.wallet_transactions
language plpgsql
security definer
set search_path=public
as $$
declare
  v_wallet public.wallet_accounts;
  v_tx public.wallet_transactions;
  v_status text := case when p_status = 'pending' then 'pending' else 'available' end;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Jumlah wallet harus lebih besar dari 0';
  end if;
  if p_direction not in ('credit','debit') then
    raise exception 'Direction wallet tidak valid';
  end if;
  if p_direction = 'debit' and v_status <> 'available' then
    raise exception 'Debit wallet wajib available';
  end if;

  select * into v_wallet
  from public.wallet_accounts
  where id = p_wallet_id
  for update;

  if not found then
    raise exception 'Wallet tidak ditemukan';
  end if;
  if v_wallet.status <> 'active' then
    raise exception 'Wallet sedang tidak aktif';
  end if;

  if p_external_reference is not null then
    select * into v_tx
    from public.wallet_transactions
    where wallet_id = p_wallet_id
      and provider is not distinct from p_provider
      and external_reference = p_external_reference
    limit 1;
    if found then
      return v_tx;
    end if;
  end if;

  if p_direction = 'debit' and v_wallet.available_balance < p_amount then
    raise exception 'Saldo tersedia tidak mencukupi';
  end if;

  insert into public.wallet_transactions(
    wallet_id, direction, status, amount, currency, source, provider,
    external_reference, category, description, occurred_at, available_at,
    metadata, created_by
  ) values (
    p_wallet_id, p_direction, v_status, round(p_amount,2), v_wallet.currency,
    coalesce(nullif(p_source,''),'manual'), nullif(p_provider,''),
    nullif(p_external_reference,''), coalesce(nullif(p_category,''),'other'),
    p_description, coalesce(p_occurred_at,now()),
    case when v_status='available' then coalesce(p_available_at,now()) else null end,
    coalesce(p_metadata,'{}'::jsonb), p_created_by
  ) returning * into v_tx;

  if p_direction = 'credit' and v_status = 'available' then
    update public.wallet_accounts
    set available_balance = available_balance + p_amount,
        total_credits = total_credits + p_amount,
        updated_at = now()
    where id = p_wallet_id;
  elsif p_direction = 'credit' and v_status = 'pending' then
    update public.wallet_accounts
    set pending_balance = pending_balance + p_amount,
        updated_at = now()
    where id = p_wallet_id;
  else
    update public.wallet_accounts
    set available_balance = available_balance - p_amount,
        total_debits = total_debits + p_amount,
        updated_at = now()
    where id = p_wallet_id;
  end if;

  return v_tx;
end;
$$;

grant execute on function public.wallet_post_transaction(uuid,text,numeric,text,text,text,text,text,text,timestamptz,timestamptz,jsonb,uuid) to service_role;

create or replace function public.wallet_settle_transaction(
  p_transaction_id uuid,
  p_settled_by uuid default null
)
returns public.wallet_transactions
language plpgsql
security definer
set search_path=public
as $$
declare
  v_tx public.wallet_transactions;
  v_wallet public.wallet_accounts;
begin
  select * into v_tx from public.wallet_transactions where id=p_transaction_id for update;
  if not found then raise exception 'Transaksi wallet tidak ditemukan'; end if;
  if v_tx.direction <> 'credit' or v_tx.status <> 'pending' then
    raise exception 'Transaksi bukan pending credit';
  end if;

  select * into v_wallet from public.wallet_accounts where id=v_tx.wallet_id for update;
  if not found then raise exception 'Wallet tidak ditemukan'; end if;

  update public.wallet_transactions
  set status='available', available_at=now(), metadata=metadata || jsonb_build_object('settled_by',p_settled_by,'settled_at',now())
  where id=v_tx.id returning * into v_tx;

  update public.wallet_accounts
  set pending_balance=pending_balance-v_tx.amount,
      available_balance=available_balance+v_tx.amount,
      total_credits=total_credits+v_tx.amount,
      updated_at=now()
  where id=v_tx.wallet_id;

  return v_tx;
end;
$$;

grant execute on function public.wallet_settle_transaction(uuid,uuid) to service_role;

create or replace function public.wallet_refresh_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end; $$;

drop trigger if exists trg_wallet_accounts_updated_at on public.wallet_accounts;
create trigger trg_wallet_accounts_updated_at before update on public.wallet_accounts for each row execute function public.wallet_refresh_updated_at();

drop trigger if exists trg_wallet_payouts_updated_at on public.wallet_payouts;
create trigger trg_wallet_payouts_updated_at before update on public.wallet_payouts for each row execute function public.wallet_refresh_updated_at();
