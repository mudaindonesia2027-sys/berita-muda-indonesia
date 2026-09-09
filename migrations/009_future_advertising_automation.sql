-- Future advertising automation. Additive migration; review against your existing schema before production.
alter table public.ad_campaigns
  add column if not exists total_budget numeric,
  add column if not exists daily_budget numeric,
  add column if not exists spent_amount numeric not null default 0,
  add column if not exists pricing_model text default 'manual',
  add column if not exists campaign_status text not null default 'draft',
  add column if not exists max_impressions bigint,
  add column if not exists max_clicks bigint,
  add column if not exists pacing_mode text default 'even',
  add column if not exists stop_reason text;

create index if not exists ad_campaigns_delivery_idx
  on public.ad_campaigns(campaign_status, active, starts_at, ends_at);

-- Application layer should atomically update spend and delivery counters.
-- Payment/provider integration is intentionally connector-based and not hard-coded.
