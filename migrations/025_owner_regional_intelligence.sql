-- MUDA V19 025 — REGIONAL INTELLIGENCE
create extension if not exists pgcrypto;
create table if not exists public.owner_content_regions (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('article','video')),
  content_id text not null,
  country text not null default 'ID',
  region_level text not null default 'regency' check (region_level in ('country','province','regency','district','city')),
  province text,
  regency text,
  district text,
  city text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  confidence numeric(5,4) not null default 1 check (confidence between 0 and 1),
  source text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(content_type,content_id)
);
create index if not exists owner_content_regions_province_idx on public.owner_content_regions(province,regency,district);
create index if not exists owner_content_regions_type_idx on public.owner_content_regions(content_type,created_at desc);
alter table public.owner_content_regions enable row level security;
revoke all on public.owner_content_regions from anon,authenticated;
grant all on public.owner_content_regions to service_role;
