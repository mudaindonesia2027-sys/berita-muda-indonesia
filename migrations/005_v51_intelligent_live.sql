-- BERITA MUDA INDONESIA V5.1 — Intelligent Live Core
-- Run after migrations 001-004.

alter table public.articles add column if not exists canonical_url text;
alter table public.articles add column if not exists content_fingerprint text;
alter table public.articles add column if not exists source_quality_score numeric not null default 50;
alter table public.articles add column if not exists freshness_score numeric not null default 0;
alter table public.articles add column if not exists engagement_score numeric not null default 0;
alter table public.articles add column if not exists intelligence_score numeric not null default 0;
alter table public.articles add column if not exists duplicate_of uuid references public.articles(id) on delete set null;
alter table public.articles add column if not exists editorial_priority integer not null default 0;

create unique index if not exists articles_canonical_url_unique on public.articles(canonical_url) where canonical_url is not null;
create index if not exists articles_fingerprint_idx on public.articles(content_fingerprint);
create index if not exists articles_intelligence_idx on public.articles(status, intelligence_score desc, published_at desc);

create table if not exists public.news_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  feed_url text not null unique,
  active boolean not null default true,
  quality_score numeric not null default 50,
  status text not null default 'unknown' check(status in ('healthy','degraded','unhealthy','unknown','disabled')),
  success_count bigint not null default 0,
  failure_count bigint not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_latency_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists news_sources_status_idx on public.news_sources(active,status);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check(status in ('running','success','partial','failed')),
  feeds_total integer not null default 0,
  feeds_failed integer not null default 0,
  rows_seen integer not null default 0,
  rows_upserted integer not null default 0,
  error_message text
);

create table if not exists public.sync_locks (
  lock_name text primary key,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  owner text
);

create or replace function public.acquire_sync_lock(p_name text, p_ttl_seconds integer default 240)
returns boolean language plpgsql security definer set search_path=public as $$
declare inserted_count integer;
begin
  delete from public.sync_locks where lock_name=p_name and expires_at < now();
  insert into public.sync_locks(lock_name,locked_at,expires_at,owner)
  values(p_name,now(),now()+make_interval(secs=>greatest(30,p_ttl_seconds)),current_setting('request.jwt.claim.sub',true))
  on conflict(lock_name) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

create or replace function public.release_sync_lock(p_name text)
returns void language sql security definer set search_path=public as $$
  delete from public.sync_locks where lock_name=p_name;
$$;

create or replace function public.rebuild_article_intelligence()
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.articles a
  set
    freshness_score = greatest(0, 100 - least(100, extract(epoch from (now()-coalesce(a.published_at,a.created_at)))/3600.0*2.5)),
    engagement_score = least(100, (coalesce(a.views,0)*1.0 + coalesce(a.likes,0)*4.0 + coalesce(a.shares,0)*7.0) / greatest(1, extract(epoch from (now()-coalesce(a.published_at,a.created_at)))/3600.0 + 2) * 8),
    intelligence_score = (
      greatest(0, 100 - least(100, extract(epoch from (now()-coalesce(a.published_at,a.created_at)))/3600.0*2.5))*0.35 +
      least(100, (coalesce(a.views,0)*1.0 + coalesce(a.likes,0)*4.0 + coalesce(a.shares,0)*7.0) / greatest(1, extract(epoch from (now()-coalesce(a.published_at,a.created_at)))/3600.0 + 2) * 8)*0.25 +
      coalesce(a.source_quality_score,50)*0.20 +
      least(100, greatest(0,a.editorial_priority*10))*0.10 +
      case when a.content_available then 10 else 0 end
    )
  where a.status='published' and a.duplicate_of is null;
end;
$$;

revoke all on function public.acquire_sync_lock(text,integer) from public;
revoke all on function public.release_sync_lock(text) from public;
revoke all on function public.rebuild_article_intelligence() from public;
grant execute on function public.acquire_sync_lock(text,integer) to service_role;
grant execute on function public.release_sync_lock(text) to service_role;
grant execute on function public.rebuild_article_intelligence() to service_role;

-- Extend analytics vocabulary for reading and video retention.
alter table public.analytics_events drop constraint if exists analytics_events_event_type_check;
alter table public.analytics_events add constraint analytics_events_event_type_check check (event_type in (
  'pageview','view','like','share','video_play','ad_impression','ad_click',
  'article_read','scroll_25','scroll_50','scroll_75','scroll_100',
  'video_25','video_50','video_75','video_complete','affiliate_click'
));
