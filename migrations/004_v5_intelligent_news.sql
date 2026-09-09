-- BERITA MUDA INDONESIA V5 — Intelligent News Content Layer
-- Run after 001, 002 and 003 on an existing Supabase project.

alter table public.articles add column if not exists content_html text;
alter table public.articles add column if not exists author_name text;
alter table public.articles add column if not exists author_url text;
alter table public.articles add column if not exists source_url text;
alter table public.articles add column if not exists tags text[] not null default '{}';
alter table public.articles add column if not exists reading_minutes integer not null default 1;
alter table public.articles add column if not exists content_source text not null default 'rss';
alter table public.articles add column if not exists content_available boolean not null default false;
alter table public.articles add column if not exists featured boolean not null default false;

create index if not exists articles_featured_idx on public.articles(featured, published_at desc);
create index if not exists articles_source_url_idx on public.articles(source_url);
create index if not exists articles_content_source_idx on public.articles(content_source);

-- Prevent empty/unsafe values from being presented as editorial content.
create or replace function public.refresh_article_reading_meta() returns trigger
language plpgsql as $$
declare words integer;
begin
  words := greatest(1, array_length(regexp_split_to_array(trim(regexp_replace(coalesce(new.content_html,''), '<[^>]+>', ' ', 'g')), '\s+'), 1));
  new.reading_minutes := greatest(1, ceil(words / 220.0)::integer);
  new.content_available := length(trim(regexp_replace(coalesce(new.content_html,''), '<[^>]+>', ' ', 'g'))) >= 80;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_articles_reading_meta on public.articles;
create trigger trg_articles_reading_meta
before insert or update of content_html on public.articles
for each row execute function public.refresh_article_reading_meta();

-- Public article payload is already protected by the published policy.
-- Rebuild trending immediately after content/engagement changes from the server.
