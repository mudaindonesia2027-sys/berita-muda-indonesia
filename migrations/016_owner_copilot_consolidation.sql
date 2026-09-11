-- MUDA Indonesia V11 — Owner Copilot + Command Planning + Voice + Undo
-- Additive only. Does not replace production content tables.
create extension if not exists pgcrypto;

create table if not exists public.owner_conversations (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  channel text not null default 'dashboard' check (channel in ('dashboard','voice','api')),
  title text,
  context jsonb not null default '{}'::jsonb,
  last_intent_key text,
  last_resource_type text,
  last_resource_id text,
  status text not null default 'active' check (status in ('active','closed','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_conversations_actor_idx on public.owner_conversations(actor_id, updated_at desc);

create table if not exists public.owner_action_plans (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.owner_conversations(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  input_text text not null,
  objective jsonb not null default '{}'::jsonb,
  risk_level text not null default 'low' check (risk_level in ('low','medium','high','critical')),
  status text not null default 'planned' check (status in ('planned','confirming','running','success','failed','cancelled','rolled_back')),
  confidence numeric(5,4),
  dry_run boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_action_plans_status_idx on public.owner_action_plans(status, created_at desc);

create table if not exists public.owner_action_plan_steps (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.owner_action_plans(id) on delete cascade,
  step_no integer not null,
  action_key text not null references public.owner_action_registry(action_key),
  payload jsonb not null default '{}'::jsonb,
  risk_level text not null default 'low' check (risk_level in ('low','medium','high','critical')),
  status text not null default 'pending' check (status in ('pending','running','success','failed','skipped','rolled_back')),
  result jsonb not null default '{}'::jsonb,
  error_text text,
  started_at timestamptz,
  finished_at timestamptz,
  unique(plan_id, step_no)
);
create index if not exists owner_action_plan_steps_plan_idx on public.owner_action_plan_steps(plan_id, step_no);

create table if not exists public.owner_action_undo (
  id uuid primary key default gen_random_uuid(),
  command_id uuid references public.owner_commands(id) on delete cascade,
  action_key text not null,
  resource_type text,
  resource_id text,
  inverse_action_key text,
  inverse_payload jsonb not null default '{}'::jsonb,
  status text not null default 'available' check (status in ('available','used','expired','not_supported')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index if not exists owner_action_undo_command_idx on public.owner_action_undo(command_id, created_at desc);

create table if not exists public.voice_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  conversation_id uuid references public.owner_conversations(id) on delete set null,
  locale text not null default 'id-ID',
  provider text not null default 'browser',
  status text not null default 'idle' check (status in ('idle','listening','processing','speaking','ended','error')),
  last_transcript text,
  last_response text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists voice_sessions_actor_idx on public.voice_sessions(actor_id, updated_at desc);

create table if not exists public.recommendation_explanations (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,
  content_id text not null,
  score numeric(12,4) not null default 0,
  factors jsonb not null default '{}'::jsonb,
  reason text,
  segment_key text,
  generated_at timestamptz not null default now()
);
create index if not exists recommendation_explanations_content_idx on public.recommendation_explanations(content_type, content_id, generated_at desc);

alter table public.owner_conversations enable row level security;
alter table public.owner_action_plans enable row level security;
alter table public.owner_action_plan_steps enable row level security;
alter table public.owner_action_undo enable row level security;
alter table public.voice_sessions enable row level security;
alter table public.recommendation_explanations enable row level security;

revoke all on public.owner_conversations, public.owner_action_plans, public.owner_action_plan_steps, public.owner_action_undo, public.voice_sessions, public.recommendation_explanations from anon, authenticated;
grant all on public.owner_conversations, public.owner_action_plans, public.owner_action_plan_steps, public.owner_action_undo, public.voice_sessions, public.recommendation_explanations to service_role;
