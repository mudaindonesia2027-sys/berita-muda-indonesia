-- MUDA V19 028 — KNOWLEDGE + TRUST / PROVENANCE
create extension if not exists pgcrypto;
create table if not exists public.owner_knowledge_entities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('person','organization','location','topic','event')),
  name text not null,
  aliases jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(entity_type,name)
);
create table if not exists public.owner_content_provenance (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('article','video','image')),
  content_id text not null,
  source_type text not null,
  source_reference text,
  evidence jsonb not null default '{}'::jsonb,
  license_status text not null default 'unknown' check (license_status in ('unknown','licensed','owned','fair_use_review','restricted')),
  ai_assisted boolean not null default false,
  human_reviewed boolean not null default false,
  correction_state text not null default 'clean' check (correction_state in ('clean','review','corrected','retracted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_content_provenance_content_idx on public.owner_content_provenance(content_type,content_id,created_at desc);
alter table public.owner_knowledge_entities enable row level security;
alter table public.owner_content_provenance enable row level security;
revoke all on public.owner_knowledge_entities from anon,authenticated;
revoke all on public.owner_content_provenance from anon,authenticated;
grant all on public.owner_knowledge_entities to service_role;
grant all on public.owner_content_provenance to service_role;
