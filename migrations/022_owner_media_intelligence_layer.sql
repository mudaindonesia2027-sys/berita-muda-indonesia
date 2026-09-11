-- MUDA Indonesia V19 — Media Intelligence / Owner Control Layer
-- Uses existing article/video/event/analytics structures; adds owner-level snapshots and decision signals.
create extension if not exists pgcrypto;

create table if not exists public.owner_media_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_at timestamptz not null default now(),
  articles_total bigint not null default 0,
  articles_published bigint not null default 0,
  videos_total bigint not null default 0,
  videos_published bigint not null default 0,
  live_events bigint not null default 0,
  breaking_active bigint not null default 0,
  top_story_id uuid,
  top_video_id uuid,
  article_views numeric(20,2) not null default 0,
  video_views numeric(20,2) not null default 0,
  engagement_rate numeric(10,4) not null default 0,
  notes text,
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists owner_media_snapshots_time_idx on public.owner_media_snapshots(snapshot_at desc);

create table if not exists public.owner_decision_signals (
  id uuid primary key default gen_random_uuid(),
  signal_key text not null,
  area text not null,
  severity text not null default 'info' check (severity in ('info','low','medium','high','critical')),
  score numeric(10,4),
  confidence numeric(10,4),
  title text not null,
  explanation text,
  recommended_action text,
  resource_type text,
  resource_id uuid,
  status text not null default 'open' check (status in ('open','acknowledged','resolved','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists owner_decision_signals_status_idx on public.owner_decision_signals(status, severity, created_at desc);

alter table public.owner_media_snapshots enable row level security;
alter table public.owner_decision_signals enable row level security;
revoke all on public.owner_media_snapshots, public.owner_decision_signals from anon, authenticated;
grant all on public.owner_media_snapshots, public.owner_decision_signals to service_role;
