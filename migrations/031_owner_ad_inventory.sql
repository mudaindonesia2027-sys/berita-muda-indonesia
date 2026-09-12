-- MUDA V19 031 — AD INVENTORY + CAMPAIGN PACING
create extension if not exists pgcrypto;
create table if not exists public.owner_ad_inventory (
  id uuid primary key default gen_random_uuid(),
  inventory_key text not null unique,
  placement text not null,
  channel text not null default 'web',
  region text,
  capacity numeric(18,4) not null default 0,
  reserved numeric(18,4) not null default 0,
  delivered numeric(18,4) not null default 0,
  rate numeric(20,2) not null default 0,
  currency text not null default 'IDR',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_ad_inventory_region_idx on public.owner_ad_inventory(region,active);
create table if not exists public.owner_ad_campaign_pacing (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.owner_ad_deals(id) on delete cascade,
  inventory_id uuid references public.owner_ad_inventory(id) on delete set null,
  period_start date,
  period_end date,
  target numeric(18,4) not null default 0,
  delivered numeric(18,4) not null default 0,
  clicks numeric(18,4) not null default 0,
  conversions numeric(18,4) not null default 0,
  pacing_status text not null default 'on_track' check (pacing_status in ('ahead','on_track','behind','at_risk','completed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_ad_campaign_pacing_deal_idx on public.owner_ad_campaign_pacing(deal_id,period_start desc);
alter table public.owner_ad_inventory enable row level security;
alter table public.owner_ad_campaign_pacing enable row level security;
revoke all on public.owner_ad_inventory from anon,authenticated;
revoke all on public.owner_ad_campaign_pacing from anon,authenticated;
grant all on public.owner_ad_inventory to service_role;
grant all on public.owner_ad_campaign_pacing to service_role;
