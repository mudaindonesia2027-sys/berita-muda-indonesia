-- MUDA INDONESIA V10 — MEDIA OPERATING SYSTEM MASTER
-- Adds the Owner OS control plane without replacing existing production tables.
-- Provider integrations remain explicit in integration_providers; never fake ACTIVE state.

create extension if not exists pgcrypto;

create table if not exists public.owner_dashboard_preferences (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  layout_key text not null default 'executive',
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_user_id, layout_key)
);

create table if not exists public.homepage_layouts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  config jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.homepage_layout_items (
  id uuid primary key default gen_random_uuid(),
  layout_id uuid not null references public.homepage_layouts(id) on delete cascade,
  slot_key text not null,
  content_type text not null check (content_type in ('article','video','event','ad','custom')),
  content_id text,
  rank integer not null default 0,
  pin_mode text not null default 'manual' check (pin_mode in ('manual','intelligent','breaking','trending','sponsored')),
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists homepage_layout_items_layout_idx on public.homepage_layout_items(layout_id, slot_key, rank);

create table if not exists public.content_revisions (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('article','video')),
  content_id text not null,
  version integer not null,
  snapshot jsonb not null,
  change_summary text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(content_type, content_id, version)
);
create index if not exists content_revisions_lookup_idx on public.content_revisions(content_type, content_id, created_at desc);

create table if not exists public.owner_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  task_type text not null default 'manual' check (task_type in ('manual','editorial','breaking','system','revenue','community','seo','automation')),
  priority integer not null default 50 check (priority between 0 and 100),
  status text not null default 'open' check (status in ('open','in_progress','done','dismissed')),
  resource_type text,
  resource_id text,
  due_at timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_tasks_status_priority_idx on public.owner_tasks(status, priority desc, due_at);

create table if not exists public.owner_alerts (
  id uuid primary key default gen_random_uuid(),
  severity text not null default 'info' check (severity in ('info','warning','error','critical')),
  title text not null,
  message text,
  status text not null default 'open' check (status in ('open','acknowledged','resolved','dismissed')),
  source text not null default 'system',
  resource_type text,
  resource_id text,
  action_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz
);
create index if not exists owner_alerts_open_idx on public.owner_alerts(status, severity, created_at desc);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references public.automation_rules(id) on delete set null,
  trigger_type text,
  status text not null check (status in ('running','success','failed','skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists automation_runs_time_idx on public.automation_runs(created_at desc);

create table if not exists public.integration_providers (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null unique,
  display_name text not null,
  category text not null default 'external',
  status text not null default 'not_configured' check (status in ('active','degraded','not_configured','disabled','error')),
  capabilities jsonb not null default '[]'::jsonb,
  safe_metadata jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.integration_providers(provider_key,display_name,category,status,capabilities)
values
 ('supabase','Supabase','core','active','["database","auth","storage"]'::jsonb),
 ('rss','RSS News Sync','core','active','["sync","source_health","event_clustering"]'::jsonb),
 ('google_oauth','Google OAuth','identity','not_configured','["login"]'::jsonb),
 ('adsense','Google AdSense','monetization','not_configured','["revenue_reporting"]'::jsonb),
 ('ai_provider','AI Provider','intelligence','not_configured','["summarization","classification","recommendation","seo_assist"]'::jsonb),
 ('scheduler','Scheduler/Worker','automation','not_configured','["cron","automation"]'::jsonb),
 ('social_distribution','Social Distribution','distribution','not_configured','["publish","share"]'::jsonb),
 ('payment_gateway','Payment Gateway','monetization','not_configured','["checkout","payment"]'::jsonb)
on conflict (provider_key) do nothing;

create or replace function public.owner_os_touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['owner_dashboard_preferences','homepage_layouts','homepage_layout_items','owner_tasks','automation_runs','integration_providers'] LOOP
    EXECUTE format('drop trigger if exists trg_%I_updated_at on public.%I', t, t);
    EXECUTE format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.owner_os_touch_updated_at()', t, t);
  END LOOP;
END $$;

alter table public.owner_dashboard_preferences enable row level security;
alter table public.homepage_layouts enable row level security;
alter table public.homepage_layout_items enable row level security;
alter table public.content_revisions enable row level security;
alter table public.owner_tasks enable row level security;
alter table public.owner_alerts enable row level security;
alter table public.automation_runs enable row level security;
alter table public.integration_providers enable row level security;

revoke all on public.owner_dashboard_preferences from anon, authenticated;
revoke all on public.homepage_layouts from anon, authenticated;
revoke all on public.homepage_layout_items from anon, authenticated;
revoke all on public.content_revisions from anon, authenticated;
revoke all on public.owner_tasks from anon, authenticated;
revoke all on public.owner_alerts from anon, authenticated;
revoke all on public.automation_runs from anon, authenticated;
revoke all on public.integration_providers from anon, authenticated;

grant all on public.owner_dashboard_preferences to service_role;
grant all on public.homepage_layouts to service_role;
grant all on public.homepage_layout_items to service_role;
grant all on public.content_revisions to service_role;
grant all on public.owner_tasks to service_role;
grant all on public.owner_alerts to service_role;
grant all on public.automation_runs to service_role;
grant all on public.integration_providers to service_role;
