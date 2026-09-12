-- MUDA V19 035 — BUSINESS, CREATOR PAY, WEB EXPERIENCE & ENGAGEMENT OS
-- Additive only. No destructive changes.
-- Purpose: expose the real operational tools Owner needs without turning the dashboard into a collection of technical engines.

create extension if not exists pgcrypto;

create table if not exists public.owner_compensation_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  contributor_type text not null default 'writer',
  content_type text not null default 'article',
  scope_type text not null default 'global',
  scope_key text,
  basis text not null default 'hybrid' check (basis in ('fixed','revenue_share','hybrid')),
  fixed_amount numeric not null default 0,
  share_rate numeric not null default 0,
  currency text not null default 'IDR',
  min_amount numeric,
  max_amount numeric,
  active boolean not null default true,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists owner_comp_rules_active_idx
  on public.owner_compensation_rules(active, effective_from desc);

create table if not exists public.owner_compensation_entries (
  id uuid primary key default gen_random_uuid(),
  contributor_key text not null,
  contributor_name text,
  content_type text not null default 'article',
  content_id text,
  period_start date,
  period_end date,
  revenue_base numeric not null default 0,
  fixed_amount numeric not null default 0,
  share_rate numeric not null default 0,
  calculated_amount numeric not null default 0,
  currency text not null default 'IDR',
  status text not null default 'proposed' check (status in ('proposed','approved','scheduled','paid','void')),
  rule_key text,
  calculation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  paid_at timestamptz
);

create index if not exists owner_comp_entries_contributor_idx
  on public.owner_compensation_entries(contributor_key,status,created_at desc);

create table if not exists public.owner_ad_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  pricing_key text not null unique,
  placement text not null,
  channel text not null default 'web',
  region text,
  base_rate numeric not null default 0,
  audience_multiplier numeric not null default 1,
  demand_multiplier numeric not null default 1,
  fill_multiplier numeric not null default 1,
  seasonal_multiplier numeric not null default 1,
  premium_multiplier numeric not null default 1,
  suggested_rate numeric not null default 0,
  approved_rate numeric not null default 0,
  currency text not null default 'IDR',
  auto_reprice boolean not null default false,
  status text not null default 'draft' check (status in ('draft','suggested','approved','active','archived')),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  formula_version text not null default 'v1',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists owner_ad_pricing_rules_active_idx
  on public.owner_ad_pricing_rules(status,channel,placement,region);

create table if not exists public.owner_site_pages (
  id uuid primary key default gen_random_uuid(),
  page_key text not null unique,
  title text not null,
  slug text not null unique,
  content_html text not null default '',
  content_json jsonb not null default '{}'::jsonb,
  seo_title text,
  seo_description text,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  version integer not null default 1,
  published_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.owner_site_navigation (
  id uuid primary key default gen_random_uuid(),
  nav_key text not null unique,
  location text not null default 'main',
  label text not null,
  href text,
  item_type text not null default 'page' check (item_type in ('page','article','video','external','quiz','challenge','custom')),
  parent_key text,
  sort_order integer not null default 0,
  visible boolean not null default true,
  start_at timestamptz,
  end_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists owner_site_nav_location_idx
  on public.owner_site_navigation(location,visible,sort_order);

create table if not exists public.owner_interactive_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_key text not null unique,
  campaign_type text not null default 'quiz' check (campaign_type in ('quiz','challenge','poll','survey','contest')),
  title text not null,
  description text,
  intro text,
  config jsonb not null default '{}'::jsonb,
  reward_config jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','scheduled','active','paused','completed','archived')),
  starts_at timestamptz,
  ends_at timestamptz,
  results_visibility text not null default 'after_submit' check (results_visibility in ('instant','after_submit','owner_only')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists owner_interactive_campaigns_status_idx
  on public.owner_interactive_campaigns(status,starts_at,ends_at);

create table if not exists public.owner_editorial_calendar (
  id uuid primary key default gen_random_uuid(),
  calendar_key text not null unique,
  event_date date not null,
  title text not null,
  event_type text not null default 'special_day',
  country text not null default 'ID',
  region text,
  content_angle text,
  suggested_formats jsonb not null default '[]'::jsonb,
  brand_voice text,
  auto_generate_draft boolean not null default true,
  auto_publish boolean not null default false,
  status text not null default 'planned' check (status in ('planned','drafted','scheduled','posted','skipped')),
  content_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists owner_editorial_calendar_date_idx
  on public.owner_editorial_calendar(event_date,status);

create table if not exists public.owner_audience_contacts (
  id uuid primary key default gen_random_uuid(),
  contact_key text not null unique,
  display_name text,
  email text,
  phone text,
  phone_verified boolean not null default false,
  consent_status text not null default 'unknown' check (consent_status in ('unknown','granted','revoked')),
  source text not null default 'owner',
  purpose text,
  retention_until timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists owner_audience_contacts_consent_idx
  on public.owner_audience_contacts(consent_status,source,updated_at desc);

create table if not exists public.owner_experience_widgets (
  id uuid primary key default gen_random_uuid(),
  widget_key text not null unique,
  widget_type text not null check (widget_type in ('weather','map','holiday_calendar','world_clock','regional_map','custom')),
  title text not null,
  provider text,
  config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists owner_experience_widgets_active_idx
  on public.owner_experience_widgets(active,sort_order);

alter table public.owner_compensation_rules enable row level security;
alter table public.owner_compensation_entries enable row level security;
alter table public.owner_ad_pricing_rules enable row level security;
alter table public.owner_site_pages enable row level security;
alter table public.owner_site_navigation enable row level security;
alter table public.owner_interactive_campaigns enable row level security;
alter table public.owner_editorial_calendar enable row level security;
alter table public.owner_audience_contacts enable row level security;
alter table public.owner_experience_widgets enable row level security;

do $$
declare
  t text;
begin
  foreach t in array [
    'owner_compensation_rules',
    'owner_compensation_entries',
    'owner_ad_pricing_rules',
    'owner_site_pages',
    'owner_site_navigation',
    'owner_interactive_campaigns',
    'owner_editorial_calendar',
    'owner_audience_contacts',
    'owner_experience_widgets'
  ]
  loop
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    if not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename=t and policyname=t||'_service_role'
    ) then
      execute format(
        'create policy %I on public.%I for all to service_role using (true) with check (true)',
        t||'_service_role',t
      );
    end if;
  end loop;
end $$;

insert into public.owner_site_pages(page_key,title,slug,content_html,status)
values
  ('about','Tentang Berita Muda Indonesia','/about.html','<h1>Tentang Berita Muda Indonesia</h1><p>Halaman profil redaksi.</p>','draft'),
  ('vision-mission','Visi & Misi','/vision-mission.html','<h1>Visi & Misi</h1><p>Kelola visi dan misi perusahaan media.</p>','draft'),
  ('editorial-guideline','Pedoman Redaksi','/editorial.html','<h1>Pedoman Redaksi</h1><p>Kelola pedoman redaksi.</p>','draft')
on conflict(page_key) do nothing;

insert into public.owner_site_navigation(nav_key,location,label,href,item_type,sort_order,visible)
values
  ('nav-home','main','Beranda','/','custom',0,true),
  ('nav-berita','main','Berita','/berita.html','custom',10,true),
  ('nav-video','main','Video','/video.html','video',20,true),
  ('nav-about','main','Tentang','/about.html','page',30,true),
  ('nav-contact','main','Kontak','/contact.html','page',40,true)
on conflict(nav_key) do nothing;

insert into public.owner_experience_widgets(widget_key,widget_type,title,provider,config,sort_order)
values
  ('primary-weather','weather','Cuaca Wilayah Utama','open-meteo','{"location":"Semarang","lat":-6.9667,"lon":110.4167,"units":"metric"}'::jsonb,10),
  ('jateng-map','regional_map','Peta Jateng','openstreetmap','{"center":[-7.3,110.4],"zoom":8}'::jsonb,20),
  ('special-days','holiday_calendar','Kalender Hari Penting','internal','{"country":"ID"}'::jsonb,30)
on conflict(widget_key) do nothing;
