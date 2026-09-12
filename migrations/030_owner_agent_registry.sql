-- MUDA V19 030 — AGENT / COPILOT REGISTRY
create extension if not exists pgcrypto;
create table if not exists public.owner_agent_registry (
  id uuid primary key default gen_random_uuid(),
  agent_key text not null unique,
  display_name text not null,
  domain text not null,
  status text not null default 'conditional' check (status in ('ready','ready_with_guard','conditional','disabled')),
  capabilities jsonb not null default '[]'::jsonb,
  policy jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.owner_agent_registry(agent_key,display_name,domain,status,capabilities) values
('owner_copilot','Owner Copilot','executive','ready','["brief","decision","scenario"]'),
('newsroom_copilot','Newsroom Copilot','content','ready_with_guard','["quality","opportunity","rewrite"]'),
('video_copilot','Video Copilot','video','ready_with_guard','["clips","retention","repurpose"]'),
('audience_copilot','Audience Copilot','audience','ready_with_guard','["segments","demand","retention"]'),
('finance_copilot','Finance Copilot','finance','ready_with_guard','["cashflow","variance","reconcile"]'),
('advertiser_copilot','Advertiser Copilot','commercial','conditional','["proposal","pacing","renewal"]')
on conflict(agent_key) do update set display_name=excluded.display_name,domain=excluded.domain,capabilities=excluded.capabilities,updated_at=now();
alter table public.owner_agent_registry enable row level security;
revoke all on public.owner_agent_registry from anon,authenticated;
grant all on public.owner_agent_registry to service_role;
