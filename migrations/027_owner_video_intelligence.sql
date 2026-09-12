-- MUDA V19 027 — VIDEO INTELLIGENCE
create extension if not exists pgcrypto;
create table if not exists public.owner_video_insight_snapshots (
  id uuid primary key default gen_random_uuid(),
  video_id text not null,
  observed_at timestamptz not null default now(),
  views bigint not null default 0,
  watch_seconds bigint not null default 0,
  average_watch_seconds numeric(12,2) not null default 0,
  completion_rate numeric(8,5) not null default 0,
  dropoff_second numeric(12,2),
  retention jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists owner_video_insight_video_time_idx on public.owner_video_insight_snapshots(video_id,observed_at desc);
create table if not exists public.owner_video_clip_queue (
  id uuid primary key default gen_random_uuid(),
  video_id text not null,
  start_ms bigint not null default 0,
  end_ms bigint,
  title text,
  reason text,
  score numeric(8,4) not null default 0,
  status text not null default 'queued' check (status in ('queued','approved','exported','rejected')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists owner_video_clip_queue_status_idx on public.owner_video_clip_queue(status,created_at desc);
alter table public.owner_video_insight_snapshots enable row level security;
alter table public.owner_video_clip_queue enable row level security;
revoke all on public.owner_video_insight_snapshots from anon,authenticated;
revoke all on public.owner_video_clip_queue from anon,authenticated;
grant all on public.owner_video_insight_snapshots to service_role;
grant all on public.owner_video_clip_queue to service_role;
