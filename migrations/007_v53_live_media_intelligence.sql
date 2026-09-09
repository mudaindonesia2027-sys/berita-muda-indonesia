-- V5.3: Live Media Intelligence, editorial control and event clustering
-- Apply after 006_v52_monetization_engine.sql

alter table public.articles add column if not exists event_key text;
alter table public.articles add column if not exists breaking boolean not null default false;
alter table public.articles add column if not exists editorial_status text not null default 'auto'
  check (editorial_status in ('auto','review','approved','rejected'));
alter table public.articles add column if not exists reviewed_at timestamptz;
alter table public.articles add column if not exists reviewed_by uuid references auth.users(id) on delete set null;

create index if not exists articles_event_key_idx on public.articles(event_key);
create index if not exists articles_breaking_idx on public.articles(breaking, published_at desc);

create table if not exists public.news_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  title text not null,
  category text,
  status text not null default 'active' check (status in ('active','watch','archived')),
  article_count integer not null default 0,
  source_count integer not null default 0,
  importance_score numeric not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists news_events_active_idx on public.news_events(status, importance_score desc, last_seen_at desc);

create table if not exists public.breaking_candidates (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  title text not null,
  category text,
  score numeric not null default 0,
  reason text,
  status text not null default 'candidate' check (status in ('candidate','approved','dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists breaking_candidates_open_key_idx
on public.breaking_candidates(event_key) where status='candidate';

-- Rebuild event summaries from recent articles. This is intentionally deterministic
-- and can be safely called after sync; editorial approval remains manual.
create or replace function public.rebuild_live_events()
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.news_events(event_key,title,category,status,article_count,source_count,importance_score,first_seen_at,last_seen_at,updated_at)
  select
    a.event_key,
    max(a.title) filter (where a.title is not null) as title,
    max(a.category) filter (where a.category is not null) as category,
    case when count(*) >= 4 then 'watch' else 'active' end,
    count(*)::int,
    count(distinct coalesce(a.source,''))::int,
    round((count(*) * 12 + count(distinct coalesce(a.source,'')) * 20 + max(coalesce(a.intelligence_score,0)))::numeric,2),
    min(coalesce(a.published_at,a.created_at)),
    max(coalesce(a.published_at,a.created_at)),
    now()
  from public.articles a
  where a.status='published' and a.event_key is not null and coalesce(a.published_at,a.created_at) >= now() - interval '72 hours'
  group by a.event_key
  on conflict(event_key) do update set
    title=excluded.title, category=excluded.category, status=excluded.status,
    article_count=excluded.article_count, source_count=excluded.source_count,
    importance_score=excluded.importance_score, last_seen_at=excluded.last_seen_at,
    updated_at=now();

  insert into public.breaking_candidates(event_key,title,category,score,reason,status,updated_at)
  select e.event_key,e.title,e.category,e.importance_score,
    concat(e.article_count,' artikel dari ',e.source_count,' sumber dalam 72 jam'),
    'candidate',now()
  from public.news_events e
  where e.article_count >= 4 and e.source_count >= 3 and e.importance_score >= 100
    and not exists(select 1 from public.breaking_candidates b where b.event_key=e.event_key and b.status='candidate')
  on conflict do nothing;
end;
$$;
revoke all on function public.rebuild_live_events() from public;
grant execute on function public.rebuild_live_events() to service_role;

alter table public.news_events enable row level security;
alter table public.breaking_candidates enable row level security;
drop policy if exists "public read active news events" on public.news_events;
create policy "public read active news events" on public.news_events for select using (status in ('active','watch'));
drop policy if exists "editor manage breaking candidates" on public.breaking_candidates;
create policy "editor manage breaking candidates" on public.breaking_candidates for all using (public.is_editor()) with check (public.is_editor());
