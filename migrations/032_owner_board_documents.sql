-- MUDA V19 032 — DOCUMENT NUMBERING + BOARD PACKS
create extension if not exists pgcrypto;
create table if not exists public.owner_document_sequences (
  id uuid primary key default gen_random_uuid(),
  document_type text not null,
  period_key text not null,
  next_number bigint not null default 1,
  prefix text not null,
  updated_at timestamptz not null default now(),
  unique(document_type,period_key)
);
create table if not exists public.owner_board_packs (
  id uuid primary key default gen_random_uuid(),
  pack_type text not null,
  period_start date,
  period_end date,
  status text not null default 'draft' check (status in ('draft','issued','archived')),
  payload jsonb not null default '{}'::jsonb,
  html_snapshot text,
  document_hash text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists owner_board_packs_type_time_idx on public.owner_board_packs(pack_type,created_at desc);
alter table public.owner_document_sequences enable row level security;
alter table public.owner_board_packs enable row level security;
revoke all on public.owner_document_sequences from anon,authenticated;
revoke all on public.owner_board_packs from anon,authenticated;
grant all on public.owner_document_sequences to service_role;
grant all on public.owner_board_packs to service_role;
