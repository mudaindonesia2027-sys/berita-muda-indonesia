-- MUDA V19 029 — EXPERIMENTATION LAB
create extension if not exists pgcrypto;
create table if not exists public.owner_experiments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  experiment_type text not null check (experiment_type in ('headline','thumbnail','homepage','recommendation','notification','advertiser_placement','video')),
  status text not null default 'draft' check (status in ('draft','running','paused','completed','archived')),
  hypothesis text,
  control jsonb not null default '{}'::jsonb,
  variants jsonb not null default '[]'::jsonb,
  primary_metric text,
  result jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_experiments_status_idx on public.owner_experiments(status,updated_at desc);
alter table public.owner_experiments enable row level security;
revoke all on public.owner_experiments from anon,authenticated;
grant all on public.owner_experiments to service_role;
