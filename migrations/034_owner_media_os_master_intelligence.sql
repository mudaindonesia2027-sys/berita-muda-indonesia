-- MUDA V19 034 — MASTER MEDIA OPERATING INTELLIGENCE LAYER
-- Additive only. Completes the missing operating records described in the V19 blueprint.
create extension if not exists pgcrypto;

create table if not exists public.owner_media_os_capabilities (
  id uuid primary key default gen_random_uuid(),
  engine_key text not null,
  engine_name text not null,
  capability_key text not null unique,
  feature_name text not null,
  status text not null default 'planned' check (status in ('active','enhanced','ready','guarded','conditional','foundation','planned')),
  maturity integer not null default 1 check (maturity between 1 and 8),
  source_ref text,
  evidence text,
  dependency jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists owner_media_os_caps_engine_idx on public.owner_media_os_capabilities(engine_key,status);

create table if not exists public.owner_story_intelligence (
  id uuid primary key default gen_random_uuid(),
  article_id text not null,
  opportunity_score numeric not null default 0,
  acceleration_score numeric not null default 0,
  source_reliability numeric,
  duplicate_cluster_key text,
  fact_check_status text not null default 'queued',
  quality_gate_status text not null default 'pending',
  workload_score numeric not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  unique(article_id)
);

create table if not exists public.owner_audience_intelligence_daily (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null,
  dau bigint not null default 0,
  wau bigint not null default 0,
  mau bigint not null default 0,
  new_users bigint not null default 0,
  returning_users bigint not null default 0,
  sessions bigint not null default 0,
  session_depth numeric not null default 0,
  recirculation_rate numeric not null default 0,
  engagement_rate numeric not null default 0,
  churn_risk numeric not null default 0,
  segment_data jsonb not null default '{}'::jsonb,
  demand_topics jsonb not null default '[]'::jsonb,
  source text not null default 'analytics',
  unique(metric_date)
);
create index if not exists owner_audience_daily_date_idx on public.owner_audience_intelligence_daily(metric_date desc);

create table if not exists public.owner_distribution_intelligence (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,
  content_id text not null,
  channel text not null,
  owned boolean not null default false,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  conversions bigint not null default 0,
  search_visibility numeric,
  ai_answer_visibility numeric,
  dependency_score numeric,
  metadata jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now()
);
create index if not exists owner_distribution_content_idx on public.owner_distribution_intelligence(content_type,content_id,channel);
create unique index if not exists owner_distribution_content_channel_uidx on public.owner_distribution_intelligence(content_type,content_id,channel);

create table if not exists public.owner_ad_rate_cards (
  id uuid primary key default gen_random_uuid(),
  rate_key text not null unique,
  placement text not null,
  channel text not null default 'web',
  region text,
  unit text not null default 'flat',
  rate numeric not null default 0,
  currency text not null default 'IDR',
  min_order numeric not null default 1,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.owner_ad_makegoods (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid,
  reason text not null,
  promised_value numeric not null default 0,
  delivered_value numeric not null default 0,
  status text not null default 'open' check (status in ('open','scheduled','fulfilled','cancelled')),
  due_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.owner_operations_incidents (
  id uuid primary key default gen_random_uuid(),
  incident_key text not null unique,
  title text not null,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','investigating','mitigating','resolved','closed')),
  service text,
  provider text,
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  sla_target_minutes integer,
  root_cause text,
  recovery_checklist jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists owner_ops_incidents_status_idx on public.owner_operations_incidents(status,severity,started_at desc);

create table if not exists public.owner_trust_claims (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,
  content_id text not null,
  claim_text text not null,
  risk_level text not null default 'medium' check (risk_level in ('low','medium','high','critical')),
  evidence_refs jsonb not null default '[]'::jsonb,
  source_diversity numeric,
  verification_status text not null default 'unverified' check (verification_status in ('unverified','checking','verified','disputed','retracted')),
  ai_assisted boolean not null default false,
  human_reviewed boolean not null default false,
  correction_state text not null default 'none' check (correction_state in ('none','pending','corrected','retracted')),
  copyright_status text not null default 'unknown' check (copyright_status in ('unknown','owned','licensed','restricted','expired')),
  generated_media_disclosure boolean not null default false,
  retention_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_trust_claims_content_idx on public.owner_trust_claims(content_type,content_id,verification_status);

create table if not exists public.owner_media_archive_records (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,
  content_id text not null,
  transcript text,
  transcript_language text,
  ocr_text text,
  scene_metadata jsonb not null default '[]'::jsonb,
  topics jsonb not null default '[]'::jsonb,
  entity_refs jsonb not null default '[]'::jsonb,
  source_refs jsonb not null default '[]'::jsonb,
  license_refs jsonb not null default '[]'::jsonb,
  searchable boolean not null default true,
  indexed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(content_type,content_id)
);
create index if not exists owner_media_archive_search_idx on public.owner_media_archive_records using gin(to_tsvector('simple',coalesce(transcript,'') || ' ' || coalesce(ocr_text,'')));

create table if not exists public.owner_platform_registry (
  id uuid primary key default gen_random_uuid(),
  tenant_key text not null default 'muda',
  brand_key text not null default 'berita-muda-indonesia',
  site_key text not null default 'main',
  locale text not null default 'id-ID',
  timezone text not null default 'Asia/Jakarta',
  currency text not null default 'IDR',
  region_scope jsonb not null default '{"country":"ID"}'::jsonb,
  cdn_strategy jsonb not null default '{}'::jsonb,
  api_partner_policy jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(tenant_key,brand_key,site_key,locale,currency)
);

create table if not exists public.owner_board_brief_runs (
  id uuid primary key default gen_random_uuid(),
  pack_type text not null,
  period_start date,
  period_end date,
  source_snapshot jsonb not null default '{}'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  decisions jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

alter table public.owner_media_os_capabilities enable row level security;
alter table public.owner_story_intelligence enable row level security;
alter table public.owner_audience_intelligence_daily enable row level security;
alter table public.owner_distribution_intelligence enable row level security;
alter table public.owner_ad_rate_cards enable row level security;
alter table public.owner_ad_makegoods enable row level security;
alter table public.owner_operations_incidents enable row level security;
alter table public.owner_trust_claims enable row level security;
alter table public.owner_media_archive_records enable row level security;
alter table public.owner_platform_registry enable row level security;
alter table public.owner_board_brief_runs enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'owner_media_os_capabilities',
    'owner_story_intelligence',
    'owner_audience_intelligence_daily',
    'owner_distribution_intelligence',
    'owner_ad_rate_cards',
    'owner_ad_makegoods',
    'owner_operations_incidents',
    'owner_trust_claims',
    'owner_media_archive_records',
    'owner_platform_registry',
    'owner_board_brief_runs'
  ]
  loop
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_service_role') then
      execute format('create policy %I on public.%I for all to service_role using (true) with check (true)',t||'_service_role',t);
    end if;
  end loop;
end $$;

insert into public.owner_platform_registry(tenant_key,brand_key,site_key,locale,timezone,currency,region_scope)
values ('muda','berita-muda-indonesia','main','id-ID','Asia/Jakarta','IDR','{"country":"ID","province":"Jawa Tengah"}'::jsonb)
on conflict do nothing;

-- Blueprint capability registry: status expresses real implementation state, not marketing.
insert into public.owner_media_os_capabilities(engine_key,engine_name,capability_key,feature_name,status,maturity,source_ref,evidence)
values
('executive_intelligence','Executive Intelligence','executive.mission_control','Mission Control','enhanced',6,'blueprint-01','V19 Mission Control + signals + money + provider truth'),
('executive_intelligence','Executive Intelligence','executive.briefing','Morning / Midday / Evening Brief','active',6,'blueprint-01','Owner brief engine already exposed'),
('executive_intelligence','Executive Intelligence','executive.anomaly_summary','Anomaly Summary','enhanced',5,'blueprint-01','Signals/performance anomaly foundations'),
('executive_intelligence','Executive Intelligence','executive.risk_heatmap','Risk Heatmap','foundation',4,'blueprint-01','Risk data stored in decision/fabric layer'),
('executive_intelligence','Executive Intelligence','executive.kpi_tree','KPI Tree','foundation',4,'blueprint-01','KPI and executive overview foundations'),
('newsroom_intelligence','Newsroom Intelligence','news.story_opportunity','Story Opportunity Score','enhanced',6,'blueprint-02','Existing owner story ranking'),
('newsroom_intelligence','Newsroom Intelligence','news.event_acceleration','Event Acceleration Radar','active',6,'blueprint-02','Breaking/event radar exists'),
('newsroom_intelligence','Newsroom Intelligence','news.source_reliability','Source Reliability','foundation',4,'blueprint-02','Reliability provider/source signals exist'),
('newsroom_intelligence','Newsroom Intelligence','news.duplicate_detection','Duplicate / Near Duplicate','planned',2,'blueprint-02','Requires content similarity worker'),
('newsroom_intelligence','Newsroom Intelligence','news.factcheck_queue','Fact-check Queue','foundation',3,'blueprint-02','Queue table available in master layer'),
('video_intelligence','Video Intelligence','video.live_monitor','Live Monitor','enhanced',6,'blueprint-03','Live monitor + video telemetry foundations'),
('video_intelligence','Video Intelligence','video.retention_curve','Retention Curve','enhanced',5,'blueprint-03','Snapshot retention array stored'),
('video_intelligence','Video Intelligence','video.clip_queue','Clip Extraction Queue','enhanced',5,'blueprint-03','Clip queue operational record exists'),
('audience_intelligence','Audience Intelligence','audience.daily_cohorts','DAU / WAU / MAU + cohort','foundation',4,'blueprint-04','Daily audience table added'),
('audience_intelligence','Audience Intelligence','audience.churn_risk','Churn / Engagement Risk','foundation',3,'blueprint-04','Risk fields captured; model can be wired'),
('distribution_intelligence','Distribution Intelligence','distribution.channel_mix','Owned vs Third-party','foundation',4,'blueprint-05','Distribution event table added'),
('distribution_intelligence','Distribution Intelligence','distribution.ai_visibility','AI Answer Visibility','planned',2,'blueprint-05','Provider/search measurement required'),
('advertising_intelligence','Advertising Intelligence','ads.crm','Advertiser CRM','enhanced',6,'blueprint-06','Commercial deal/contact layer exists'),
('advertising_intelligence','Advertising Intelligence','ads.rate_card','Rate Card','foundation',4,'blueprint-06','Rate card table added'),
('advertising_intelligence','Advertising Intelligence','ads.makegood','Make-good Management','foundation',3,'blueprint-06','Make-good ledger added'),
('commercial_billing','Commercial & Billing OS','commercial.docs','Quotation / Order / Invoice / Receipt','enhanced',6,'blueprint-07','Commercial document generation exists'),
('commercial_billing','Commercial & Billing OS','commercial.numbering','Document Numbering','foundation',4,'blueprint-07','Sequence table exists; legacy generator still needs migration'),
('finance_intelligence','Finance Intelligence','finance.canonical_ledger','Canonical Ledger','active',7,'blueprint-08','V19 canonical ledger + reconciliation'),
('finance_intelligence','Finance Intelligence','finance.anomaly','Finance Anomaly Detection','foundation',4,'blueprint-08','Decision/risk layer can consume finance anomalies'),
('operations_intelligence','Operations Intelligence','ops.provider_health','Provider Health','active',6,'blueprint-09','Provider health endpoints already exist'),
('operations_intelligence','Operations Intelligence','ops.incident_commander','Incident Commander','active',6,'blueprint-09','Incident command foundation exists'),
('trust_safety','Trust & Safety','trust.provenance','Provenance / Copyright','enhanced',5,'blueprint-10','Provenance table exists + trust claims'),
('trust_safety','Trust & Safety','trust.correction','Correction / Retraction','foundation',4,'blueprint-10','Correction state now persisted'),
('knowledge_archive','Knowledge & Archive','knowledge.entities','People / Org / Location Graph','enhanced',5,'blueprint-11','Knowledge entity registry + canonical entity fabric'),
('knowledge_archive','Knowledge & Archive','knowledge.archive_search','Archive Search','foundation',3,'blueprint-11','Archive index table ready'),
('ai_agent_layer','AI / Agent Layer','ai.agent_mesh','Agent Mesh','guarded',4,'blueprint-12','Agent registry + approval-gated runs'),
('ai_agent_layer','AI / Agent Layer','ai.workflow_planner','Workflow Planner','foundation',3,'blueprint-12','Agent task registry available'),
('ai_agent_layer','AI / Agent Layer','ai.what_if','What-if Simulator','guarded',4,'blueprint-12','Scenario runner available'),
('experimentation','Experimentation Lab','experiment.registry','Experiment Registry','enhanced',5,'blueprint-13','Experiment table exists'),
('experimentation','Experimentation Lab','experiment.outcomes','Statistical Result Log','foundation',3,'blueprint-13','Outcome storage available'),
('platform_globalization','Platform & Globalization','platform.locale','Locale / Timezone / Currency','foundation',4,'blueprint-14','Platform registry seeded id-ID/IDR'),
('platform_globalization','Platform & Globalization','platform.multi_tenant','Multi-brand / Multi-site / Tenant','conditional',2,'blueprint-14','Data model foundation only'),
('board_owner_intelligence','Board / Owner Intelligence','board.brief_pack','Daily / Weekly / Monthly Pack','foundation',4,'blueprint-15','Board pack + brief run tables exist'),
('board_owner_intelligence','Board / Owner Intelligence','board.risk_register','Risk Register','foundation',4,'blueprint-15','Decision/risk fabric is source of truth')
on conflict(capability_key) do update set status=excluded.status,maturity=excluded.maturity,evidence=excluded.evidence,updated_at=now();
