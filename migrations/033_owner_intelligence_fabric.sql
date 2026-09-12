-- V19 Enterprise Intelligence Fabric
-- Menyatukan entity, event, decision, scenario, agent-run, capability dan audit.
create extension if not exists pgcrypto;

create table if not exists public.owner_os_entities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  canonical_key text not null unique,
  display_name text,
  region jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_owner_os_entities_type on public.owner_os_entities(entity_type);
create index if not exists idx_owner_os_entities_region on public.owner_os_entities using gin(region);

create table if not exists public.owner_os_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  domain text not null,
  entity_key text,
  severity text not null default 'info',
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  correlation_id uuid not null default gen_random_uuid()
);
create index if not exists idx_owner_os_events_time on public.owner_os_events(occurred_at desc);
create index if not exists idx_owner_os_events_domain on public.owner_os_events(domain, event_type);
create index if not exists idx_owner_os_events_entity on public.owner_os_events(entity_key);

create table if not exists public.owner_os_decisions (
  id uuid primary key default gen_random_uuid(),
  decision_key text not null,
  signal_id uuid,
  domain text not null,
  risk_level text not null default 'low',
  recommendation text,
  action_type text,
  approval_status text not null default 'pending',
  action_status text not null default 'not_started',
  owner_id uuid,
  decision_data jsonb not null default '{}'::jsonb,
  outcome_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_owner_os_decisions_status on public.owner_os_decisions(approval_status, action_status);
create index if not exists idx_owner_os_decisions_domain on public.owner_os_decisions(domain, created_at desc);

create table if not exists public.owner_os_scenarios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null,
  baseline jsonb not null default '{}'::jsonb,
  assumptions jsonb not null default '{}'::jsonb,
  projections jsonb not null default '{}'::jsonb,
  risk_summary jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_owner_os_scenarios_domain on public.owner_os_scenarios(domain, updated_at desc);

create table if not exists public.owner_agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_key text not null,
  task_key text not null,
  status text not null default 'queued',
  risk_level text not null default 'low',
  input_data jsonb not null default '{}'::jsonb,
  output_data jsonb not null default '{}'::jsonb,
  approval_required boolean not null default true,
  approved_by uuid,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_owner_agent_runs_agent on public.owner_agent_runs(agent_key, created_at desc);
create index if not exists idx_owner_agent_runs_status on public.owner_agent_runs(status, approval_required);

create table if not exists public.owner_os_capabilities (
  id uuid primary key default gen_random_uuid(),
  capability_key text not null unique,
  domain text not null,
  status text not null default 'planned',
  maturity integer not null default 1 check (maturity between 1 and 8),
  provider text,
  evidence text,
  dependency jsonb not null default '{}'::jsonb,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.owner_os_entities enable row level security;
alter table public.owner_os_events enable row level security;
alter table public.owner_os_decisions enable row level security;
alter table public.owner_os_scenarios enable row level security;
alter table public.owner_agent_runs enable row level security;
alter table public.owner_os_capabilities enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='owner_os_entities' and policyname='owner_os_entities_service_role') then
    create policy owner_os_entities_service_role on public.owner_os_entities for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='owner_os_events' and policyname='owner_os_events_service_role') then
    create policy owner_os_events_service_role on public.owner_os_events for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='owner_os_decisions' and policyname='owner_os_decisions_service_role') then
    create policy owner_os_decisions_service_role on public.owner_os_decisions for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='owner_os_scenarios' and policyname='owner_os_scenarios_service_role') then
    create policy owner_os_scenarios_service_role on public.owner_os_scenarios for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='owner_agent_runs' and policyname='owner_agent_runs_service_role') then
    create policy owner_agent_runs_service_role on public.owner_agent_runs for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='owner_os_capabilities' and policyname='owner_os_capabilities_service_role') then
    create policy owner_os_capabilities_service_role on public.owner_os_capabilities for all to service_role using (true) with check (true);
  end if;
end $$;

insert into public.owner_os_capabilities(capability_key,domain,status,maturity,provider,evidence)
values
('unified_entity_fabric','platform','ready',4,'internal','Entity registry menyatukan article/video/person/org/location/campaign/finance objects.'),
('universal_event_fabric','platform','ready',4,'internal','Event log untuk signal, workflow, action, outcome dan audit correlation.'),
('decision_risk_gate','intelligence','guarded',5,'internal','Decision record + approval/action status; autonomous action tetap dibatasi.'),
('scenario_what_if','intelligence','guarded',3,'internal','Scenario baseline/assumption/projection foundation.'),
('agent_execution_bus','ai','guarded',3,'internal','Agent run registry dengan approval_required dan audit fields.'),
('globalization_foundation','platform','conditional',2,'internal','Siap dikembangkan ke multi-brand, multi-site, currency dan timezone.'),
('enterprise_media_memory','knowledge','guarded',4,'internal','Entity/event/provenance menjadi dasar knowledge graph dan media memory.')
on conflict (capability_key) do update set updated_at=now(), evidence=excluded.evidence;
