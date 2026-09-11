-- MUDA Indonesia V10.4 — Intelligence + Performance Layer
-- Additive only. No production content tables are dropped or replaced.
create extension if not exists pgcrypto;

create table if not exists public.owner_insights (
  id uuid primary key default gen_random_uuid(),
  insight_type text not null,
  priority integer not null default 50 check (priority between 0 and 100),
  title text not null,
  reason text,
  confidence numeric(5,4),
  action_key text,
  resource_type text,
  resource_id text,
  status text not null default 'open' check (status in ('open','accepted','dismissed','expired','completed')),
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_insights_status_priority_idx on public.owner_insights(status, priority desc, created_at desc);
create index if not exists owner_insights_resource_idx on public.owner_insights(resource_type, resource_id);

create table if not exists public.story_clusters (
  id uuid primary key default gen_random_uuid(),
  cluster_key text not null unique,
  title text not null,
  category text,
  confidence numeric(5,4),
  importance_score numeric(10,2) not null default 0,
  article_count integer not null default 0,
  source_count integer not null default 0,
  velocity_score numeric(10,2) not null default 0,
  status text not null default 'watch' check (status in ('watch','active','closed')),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists story_clusters_active_idx on public.story_clusters(status, importance_score desc, last_seen_at desc);

create table if not exists public.story_cluster_items (
  cluster_id uuid not null references public.story_clusters(id) on delete cascade,
  content_type text not null,
  content_id text not null,
  relevance numeric(5,4) not null default 0,
  created_at timestamptz not null default now(),
  primary key (cluster_id, content_type, content_id)
);
create index if not exists story_cluster_items_content_idx on public.story_cluster_items(content_type, content_id);

create table if not exists public.audience_insights (
  id uuid primary key default gen_random_uuid(),
  segment_key text not null,
  segment_name text not null,
  window_days integer not null default 7,
  metrics jsonb not null default '{}'::jsonb,
  confidence numeric(5,4),
  generated_at timestamptz not null default now()
);
create index if not exists audience_insights_segment_idx on public.audience_insights(segment_key, generated_at desc);

create table if not exists public.revenue_forecasts (
  id uuid primary key default gen_random_uuid(),
  window_days integer not null default 7,
  currency text not null default 'IDR',
  historical_days integer not null default 30,
  historical_total numeric(20,2) not null default 0,
  daily_average numeric(20,2) not null default 0,
  forecast_total numeric(20,2) not null default 0,
  confidence numeric(5,4),
  by_source jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now()
);
create index if not exists revenue_forecasts_generated_idx on public.revenue_forecasts(generated_at desc);

create table if not exists public.performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  total_ms integer,
  p50_ms numeric,
  p95_ms numeric,
  error_rate numeric,
  payload jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now()
);
create index if not exists performance_snapshots_scope_idx on public.performance_snapshots(scope, generated_at desc);

create table if not exists public.homepage_autopilot_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null default 'intelligent',
  status text not null default 'planned' check (status in ('planned','preview','published','cancelled','failed')),
  objective jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  confidence numeric(5,4),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.provider_health_checks (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  status text not null,
  latency_ms integer,
  details jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now()
);
create index if not exists provider_health_checks_idx on public.provider_health_checks(provider_key, checked_at desc);

create table if not exists public.source_test_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.news_sources(id) on delete cascade,
  ok boolean not null default false,
  http_status integer,
  latency_ms integer,
  bytes integer,
  content_type text,
  feed_detected boolean,
  details jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists source_test_runs_idx on public.source_test_runs(source_id, created_at desc);

alter table public.owner_insights enable row level security;
alter table public.story_clusters enable row level security;
alter table public.story_cluster_items enable row level security;
alter table public.audience_insights enable row level security;
alter table public.revenue_forecasts enable row level security;
alter table public.performance_snapshots enable row level security;
alter table public.homepage_autopilot_runs enable row level security;
alter table public.provider_health_checks enable row level security;
alter table public.source_test_runs enable row level security;

revoke all on public.owner_insights, public.story_clusters, public.story_cluster_items, public.audience_insights, public.revenue_forecasts, public.performance_snapshots, public.homepage_autopilot_runs, public.provider_health_checks, public.source_test_runs from anon, authenticated;
grant all on public.owner_insights, public.story_clusters, public.story_cluster_items, public.audience_insights, public.revenue_forecasts, public.performance_snapshots, public.homepage_autopilot_runs, public.provider_health_checks, public.source_test_runs to service_role;
