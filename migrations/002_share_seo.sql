-- BERITA MUDA INDONESIA: share tracking + social SEO support
alter table public.articles add column if not exists shares bigint not null default 0;
alter table public.videos add column if not exists shares bigint not null default 0;

create or replace function public.increment_article_shares(article_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.articles set shares = coalesce(shares,0) + 1, updated_at = now() where id = article_id and status = 'published';
$$;

create or replace function public.increment_video_shares(video_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.videos set shares = coalesce(shares,0) + 1, updated_at = now() where id = video_id and status = 'published';
$$;

grant execute on function public.increment_article_shares(uuid) to anon, authenticated;
grant execute on function public.increment_video_shares(uuid) to anon, authenticated;
