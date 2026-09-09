create extension if not exists pgcrypto;
create table if not exists public.articles (
 id uuid primary key default gen_random_uuid(), title text not null, summary text, url text unique not null,
 image_url text, source text not null default 'ANTARA', category text not null default 'NASIONAL',
 published_at timestamptz, views bigint not null default 0, likes bigint not null default 0,
 status text not null default 'published' check(status in ('draft','published','archived')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists articles_category_idx on public.articles(category);
create index if not exists articles_published_idx on public.articles(published_at desc);
create table if not exists public.videos (
 id uuid primary key default gen_random_uuid(), title text not null, description text, video_url text not null,
 thumbnail_url text, source text not null default 'ADMIN', category text not null default 'VIDEO',
 views bigint not null default 0, likes bigint not null default 0, status text not null default 'draft' check(status in ('draft','published','archived')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.admins (id uuid primary key default gen_random_uuid(), email text unique not null, password_hash text not null, created_at timestamptz default now());
create or replace function increment_article_views(article_id uuid) returns void language sql security definer as $$ update public.articles set views=views+1 where id=article_id; $$;
create or replace function increment_article_likes(article_id uuid) returns void language sql security definer as $$ update public.articles set likes=likes+1 where id=article_id; $$;
create or replace function increment_video_views(video_id uuid) returns void language sql security definer as $$ update public.videos set views=views+1 where id=video_id; $$;
create or replace function increment_video_likes(video_id uuid) returns void language sql security definer as $$ update public.videos set likes=likes+1 where id=video_id; $$;
-- Storage bucket: create manually in Supabase dashboard as `videos` (public) and `thumbnails` (public), or use the Storage API.
