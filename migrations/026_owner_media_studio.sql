-- MUDA V19 026 — MEDIA STUDIO / NON-DESTRUCTIVE EDIT PROJECTS
create extension if not exists pgcrypto;
create table if not exists public.owner_media_assets (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('article','video','image','audio')),
  content_id text,
  asset_role text not null default 'primary',
  source_url text,
  storage_path text,
  mime_type text,
  byte_size bigint,
  width integer,
  height integer,
  duration_ms bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists owner_media_assets_content_idx on public.owner_media_assets(content_type,content_id,created_at desc);
create table if not exists public.owner_media_edit_projects (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('article','video','image')),
  content_id text,
  name text not null,
  status text not null default 'draft' check (status in ('draft','ready','exported','archived')),
  narrative jsonb not null default '{}'::jsonb,
  visual jsonb not null default '{}'::jsonb,
  video jsonb not null default '{}'::jsonb,
  export jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_media_edit_projects_content_idx on public.owner_media_edit_projects(content_type,content_id,updated_at desc);
alter table public.owner_media_assets enable row level security;
alter table public.owner_media_edit_projects enable row level security;
revoke all on public.owner_media_assets from anon,authenticated;
revoke all on public.owner_media_edit_projects from anon,authenticated;
grant all on public.owner_media_assets to service_role;
grant all on public.owner_media_edit_projects to service_role;
