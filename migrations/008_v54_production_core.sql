-- BERITA MUDA INDONESIA V5.4 — Production Core
-- Apply after 007_v53_live_media_intelligence.sql

-- Community moderation
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('article','video')),
  content_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  parent_id uuid references public.comments(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  status text not null default 'pending' check (status in ('approved','pending','hidden','blocked','deleted')),
  moderation_score numeric not null default 0,
  moderation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists comments_content_idx on public.comments(content_type, content_id, status, created_at desc);
create index if not exists comments_user_idx on public.comments(user_id, created_at desc);

create table if not exists public.comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete set null,
  reason text not null check (char_length(trim(reason)) between 1 and 500),
  created_at timestamptz not null default now(),
  unique(comment_id, reporter_id)
);

create table if not exists public.user_reputation (
  user_id uuid primary key references auth.users(id) on delete cascade,
  trust_score integer not null default 50 check (trust_score between 0 and 100),
  approved_comments integer not null default 0,
  rejected_comments integer not null default 0,
  last_comment_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Owner and security audit trail
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text,
  action text not null,
  resource_type text,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);
create index if not exists audit_logs_resource_idx on public.audit_logs(resource_type, resource_id, created_at desc);

create table if not exists public.system_events (
  id bigint generated always as identity primary key,
  severity text not null default 'info' check (severity in ('info','warning','error','critical')),
  component text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists system_events_open_idx on public.system_events(resolved_at, severity, created_at desc);

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  enabled boolean not null default true,
  trigger_type text not null,
  condition jsonb not null default '{}'::jsonb,
  action jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: public can only read approved comments. Server handles writes/moderation.
alter table public.comments enable row level security;
alter table public.comment_reports enable row level security;
alter table public.user_reputation enable row level security;
alter table public.audit_logs enable row level security;
alter table public.system_events enable row level security;
alter table public.automation_rules enable row level security;

drop policy if exists "public read approved comments" on public.comments;
create policy "public read approved comments" on public.comments for select using (status='approved');

-- Helper to keep moderation decisions auditable and deterministic.
create or replace function public.refresh_comment_reputation(p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_user_id is null then return; end if;
  insert into public.user_reputation(user_id, trust_score, approved_comments, rejected_comments, last_comment_at, updated_at)
  select
    p_user_id,
    greatest(0, least(100, 50 + count(*) filter(where status='approved') * 2 - count(*) filter(where status in ('hidden','blocked','deleted')) * 8))::int,
    count(*) filter(where status='approved')::int,
    count(*) filter(where status in ('hidden','blocked','deleted'))::int,
    max(created_at), now()
  from public.comments where user_id=p_user_id
  on conflict(user_id) do update set
    trust_score=excluded.trust_score,
    approved_comments=excluded.approved_comments,
    rejected_comments=excluded.rejected_comments,
    last_comment_at=excluded.last_comment_at,
    updated_at=now();
end;
$$;
revoke all on function public.refresh_comment_reputation(uuid) from public;
grant execute on function public.refresh_comment_reputation(uuid) to service_role;
