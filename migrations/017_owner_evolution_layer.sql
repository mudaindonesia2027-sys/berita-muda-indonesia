-- MUDA Indonesia V14 — Owner Evolution Layer
-- Additive only. No production content tables are dropped or replaced.
create extension if not exists pgcrypto;

create table if not exists public.owner_goals (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  title text not null,
  objective jsonb not null default '{}'::jsonb,
  horizon text,
  target_value numeric,
  unit text,
  status text not null default 'active' check (status in ('draft','active','paused','achieved','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_goals_status_idx on public.owner_goals(status, updated_at desc);

create table if not exists public.owner_goal_metrics (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.owner_goals(id) on delete cascade,
  metric_key text not null,
  observed_value numeric,
  target_value numeric,
  confidence numeric(5,4),
  factors jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now()
);
create index if not exists owner_goal_metrics_goal_idx on public.owner_goal_metrics(goal_id, observed_at desc);

create table if not exists public.owner_decision_outcomes (
  id uuid primary key default gen_random_uuid(),
  insight_id uuid references public.owner_insights(id) on delete set null,
  command_id uuid references public.owner_commands(id) on delete set null,
  action_key text,
  resource_type text,
  resource_id text,
  accepted boolean,
  outcome_score numeric(10,4),
  notes text,
  before_metrics jsonb not null default '{}'::jsonb,
  after_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists owner_decision_outcomes_created_idx on public.owner_decision_outcomes(created_at desc);

create table if not exists public.owner_daily_briefs (
  id uuid primary key default gen_random_uuid(),
  brief_date date not null,
  brief_type text not null check (brief_type in ('morning','midday','evening','incident')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(brief_date, brief_type)
);
create index if not exists owner_daily_briefs_date_idx on public.owner_daily_briefs(brief_date desc, brief_type);

create table if not exists public.owner_autonomy_policies (
  id uuid primary key default gen_random_uuid(),
  action_key text not null unique,
  mode text not null default 'assisted' check (mode in ('assisted','semi_auto','auto')),
  enabled boolean not null default true,
  max_risk text not null default 'low' check (max_risk in ('low','medium','high','critical')),
  min_role text not null default 'owner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_autonomy_policies_mode_idx on public.owner_autonomy_policies(mode, enabled);

create table if not exists public.owner_scenarios (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  scenario_key text not null,
  title text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  confidence numeric(5,4),
  risk_level text not null default 'low' check (risk_level in ('low','medium','high','critical')),
  created_at timestamptz not null default now()
);
create index if not exists owner_scenarios_created_idx on public.owner_scenarios(created_at desc);

create table if not exists public.owner_feature_catalog (
  id uuid primary key default gen_random_uuid(),
  feature_key text not null unique,
  area text not null,
  capability text not null,
  status text not null default 'active' check (status in ('planned','active','enhanced','provider_dependent','foundation','deprecated')),
  evidence text,
  route text,
  provider_dependency text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_feature_catalog_area_idx on public.owner_feature_catalog(area, status);

alter table public.owner_goals enable row level security;
alter table public.owner_goal_metrics enable row level security;
alter table public.owner_decision_outcomes enable row level security;
alter table public.owner_daily_briefs enable row level security;
alter table public.owner_autonomy_policies enable row level security;
alter table public.owner_scenarios enable row level security;
alter table public.owner_feature_catalog enable row level security;

revoke all on public.owner_goals, public.owner_goal_metrics, public.owner_decision_outcomes, public.owner_daily_briefs, public.owner_autonomy_policies, public.owner_scenarios, public.owner_feature_catalog from anon, authenticated;
grant all on public.owner_goals, public.owner_goal_metrics, public.owner_decision_outcomes, public.owner_daily_briefs, public.owner_autonomy_policies, public.owner_scenarios, public.owner_feature_catalog to service_role;

insert into public.owner_autonomy_policies(action_key,mode,enabled,max_risk,min_role)
values
('sync_news','auto',true,'low','owner'),
('run_health_check','auto',true,'low','admin'),
('test_source','auto',true,'low','admin'),
('rebuild_trending','auto',true,'low','admin'),
('rebuild_live_events','auto',true,'low','admin'),
('refresh_recommendations','semi_auto',true,'medium','owner'),
('publish_article','semi_auto',true,'medium','owner'),
('feature_homepage','semi_auto',true,'medium','owner'),
('toggle_ad_campaign','semi_auto',true,'medium','owner'),
('approve_payout','assisted',true,'high','super_admin'),
('change_admin_role','assisted',true,'critical','super_admin'),
('emergency_stop_automation','assisted',true,'critical','super_admin')
on conflict (action_key) do nothing;

insert into public.owner_feature_catalog(feature_key,area,capability,status,evidence,route)
values
('owner.copilot','Owner','Stateful conversational copilot','enhanced','owner_conversations + action plans','/api/admin/owner/command'),
('owner.context','Owner','Context and follow-up commands','enhanced','conversation last resource / intent','/api/admin/owner/copilot/plan'),
('owner.planner','Owner','Multi-step action planning','active','owner_action_plans + steps','/api/admin/owner/copilot/plan'),
('owner.dry_run','Owner','Dry-run and scenario preview','enhanced','simulation + scenario records','/api/admin/owner/simulate'),
('owner.undo','Owner','Undo foundation','active','owner_action_undo','/api/admin/owner/undo'),
('owner.voice','Owner','Voice command routing','active','voice_sessions + shared command bus','/admin.html'),
('owner.decision','Decision','Prioritized decision stack','enhanced','ownerDecisionBrief','/api/admin/owner/intelligence'),
('owner.goals','Decision','Goal-driven operating mode','active','owner_goals + metrics','/api/admin/owner/goals'),
('owner.what_if','Decision','What-if simulation','enhanced','owner_scenarios','/api/admin/owner/simulate'),
('owner.timeline','Decision','Universal activity timeline','active','audit_logs + owner_commands','/api/admin/owner/timeline'),
('owner.briefs','Decision','Morning / midday / evening briefs','active','owner_daily_briefs','/api/admin/owner/briefing'),
('intelligence.story_opportunity','Intelligence','Story opportunity scoring','enhanced','freshness + engagement + intelligence + reach','/api/admin/owner/intelligence'),
('intelligence.event_radar','Intelligence','Event acceleration radar','active','breaking candidates + story clusters','/api/admin/owner/intelligence'),
('intelligence.explainability','Intelligence','Recommendation why / factors','foundation','recommendation_explanations','/api/admin/owner/recommendations'),
('intelligence.learning','Intelligence','Outcome feedback loop','foundation','owner_decision_outcomes','/api/admin/owner/outcomes'),
('newsroom.publish_now','Newsroom','What should I publish now','enhanced','ranked story opportunity','/api/admin/owner/intelligence'),
('newsroom.quality_gate','Newsroom','Quality gate','foundation','editorial checks + revisions','/admin.html'),
('homepage.autopilot','Distribution','Homepage autopilot','foundation','homepage_autopilot_runs','/admin.html'),
('homepage.what_if','Distribution','Homepage scenario modeling','enhanced','simulator','/api/admin/owner/simulate'),
('audience.demand','Audience','Demand / engagement intelligence','enhanced','analytics events + audience_insights','/api/admin/owner/intelligence'),
('money.forecast','Money','Revenue run-rate / forecast','enhanced','revenue_forecasts + revenue entries','/api/admin/owner/intelligence'),
('ops.self_heal','Operations','Detect → diagnose → recover → verify','foundation','source health + automation + alerts','/admin.html'),
('ops.incident','Operations','Incident commander','active','owner_alerts + system events','/api/admin/owner/timeline'),
('ops.source_intel','Operations','Source reputation score','enhanced','failure + latency + freshness','/api/admin/owner/intelligence'),
('governance.autonomy','Governance','Assisted / semi-auto / auto policies','active','owner_autonomy_policies','/api/admin/owner/autonomy'),
('governance.audit','Governance','Audit and verification','active','audit logs + command history','/api/admin/owner/timeline'),
('evolution.learning','Evolution','Recommend → execute → observe → learn','foundation','owner_decision_outcomes','/api/admin/owner/outcomes')
on conflict (feature_key) do nothing;
