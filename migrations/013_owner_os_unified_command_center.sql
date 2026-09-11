-- MUDA INDONESIA V10.1 — UNIFIED OWNER COMMAND CENTER
-- Safe, auditable control-plane for owner intent, operations, automation and money.
-- This is additive and does not replace production tables.

create extension if not exists pgcrypto;

create table if not exists public.owner_action_registry (
  action_key text primary key,
  display_name text not null,
  category text not null,
  description text,
  risk_level text not null default 'low' check (risk_level in ('low','medium','high','critical')),
  requires_confirmation boolean not null default false,
  enabled boolean not null default true,
  capabilities jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.owner_action_registry(action_key,display_name,category,description,risk_level,requires_confirmation,capabilities)
values
 ('sync_news','Sync berita','newsroom','Jalankan sinkronisasi berita dan rebuild intelligence/trending/live events.','medium',false,'["rss","intelligence","trending","events"]'::jsonb),
 ('run_breaking','Jalankan breaking engine','newsroom','Evaluasi kandidat breaking dan pipeline breaking.','medium',false,'["breaking"]'::jsonb),
 ('publish_article','Publish artikel','editorial','Publikasikan satu artikel.','high',true,'["editorial","seo"]'::jsonb),
 ('publish_video','Publish video','media','Publikasikan satu video.','high',true,'["media","seo"]'::jsonb),
 ('archive_article','Arsipkan artikel','editorial','Arsipkan artikel secara aman.','medium',true,'["editorial"]'::jsonb),
 ('feature_article','Jadikan featured','homepage','Tandai artikel sebagai featured.','medium',false,'["homepage"]'::jsonb),
 ('unfeature_article','Hapus featured','homepage','Lepas tanda featured.','low',false,'["homepage"]'::jsonb),
 ('publish_homepage','Publish homepage layout','homepage','Aktifkan satu layout homepage sebagai published.','high',true,'["homepage"]'::jsonb),
 ('toggle_source','Aktif/nonaktif source','operations','Mengubah source RSS.','high',true,'["rss","reliability"]'::jsonb),
 ('moderate_comment','Moderasi komentar','community','Approve/hide/block komentar.','medium',true,'["community","reputation"]'::jsonb),
 ('ack_alert','Acknowledge alert','operations','Tandai alert sebagai acknowledged.','low',false,'["alerts"]'::jsonb),
 ('create_task','Buat task owner','governance','Membuat task operasional/editorial.','low',false,'["tasks"]'::jsonb)
on conflict (action_key) do update set
 display_name=excluded.display_name, category=excluded.category, description=excluded.description,
 risk_level=excluded.risk_level, requires_confirmation=excluded.requires_confirmation,
 capabilities=excluded.capabilities, updated_at=now();

create table if not exists public.owner_commands (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text,
  input_text text not null,
  intent_key text,
  parsed_payload jsonb not null default '{}'::jsonb,
  risk_level text,
  status text not null default 'accepted' check (status in ('accepted','needs_confirmation','running','success','failed','rejected')),
  result jsonb not null default '{}'::jsonb,
  error_text text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists owner_commands_created_idx on public.owner_commands(created_at desc);
create index if not exists owner_commands_status_idx on public.owner_commands(status, created_at desc);

create table if not exists public.scheduled_operations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  action_key text not null references public.owner_action_registry(action_key),
  cron_expression text,
  timezone text not null default 'Asia/Jakarta',
  enabled boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_status text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scheduled_operations_due_idx on public.scheduled_operations(enabled,next_run_at);

create table if not exists public.wallet_reconciliations (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid references public.wallet_accounts(id) on delete cascade,
  provider text,
  period_start timestamptz,
  period_end timestamptz,
  expected_credit numeric(18,2) not null default 0,
  expected_debit numeric(18,2) not null default 0,
  actual_credit numeric(18,2) not null default 0,
  actual_debit numeric(18,2) not null default 0,
  variance numeric(18,2) not null default 0,
  status text not null default 'open' check (status in ('open','matched','investigate','resolved')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists wallet_reconciliations_status_idx on public.wallet_reconciliations(status,created_at desc);

create or replace function public.owner_os_sync_public_homepage()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The API reads the latest published layout directly; this function is a compatibility hook.
  perform 1 from public.homepage_layouts where status='published' order by published_at desc nulls last, updated_at desc limit 1;
end;
$$;

DO $$
BEGIN
  EXECUTE 'drop trigger if exists trg_owner_action_registry_updated_at on public.owner_action_registry';
  EXECUTE 'create trigger trg_owner_action_registry_updated_at before update on public.owner_action_registry for each row execute function public.owner_os_touch_updated_at()';
  EXECUTE 'drop trigger if exists trg_scheduled_operations_updated_at on public.scheduled_operations';
  EXECUTE 'create trigger trg_scheduled_operations_updated_at before update on public.scheduled_operations for each row execute function public.owner_os_touch_updated_at()';
END $$;

alter table public.owner_action_registry enable row level security;
alter table public.owner_commands enable row level security;
alter table public.scheduled_operations enable row level security;
alter table public.wallet_reconciliations enable row level security;

revoke all on public.owner_action_registry from anon, authenticated;
revoke all on public.owner_commands from anon, authenticated;
revoke all on public.scheduled_operations from anon, authenticated;
revoke all on public.wallet_reconciliations from anon, authenticated;

grant all on public.owner_action_registry to service_role;
grant all on public.owner_commands to service_role;
grant all on public.scheduled_operations to service_role;
grant all on public.wallet_reconciliations to service_role;

create or replace view public.owner_wallet_summary as
select
  wa.id as wallet_id,
  wa.available_balance,
  wa.pending_balance,
  wa.total_credits,
  wa.total_debits,
  coalesce(sum(case when wt.status='pending' then case when wt.direction='credit' then wt.amount else -wt.amount end else 0 end),0) as pending_from_transactions,
  coalesce(sum(case when wt.status='available' then case when wt.direction='credit' then wt.amount else -wt.amount end else 0 end),0) as available_from_transactions,
  coalesce(sum(case when wp.status in ('requested','approved') then wp.amount else 0 end),0) as payout_reserved
from public.wallet_accounts wa
left join public.wallet_transactions wt on wt.wallet_id = wa.id
left join public.wallet_payouts wp on wp.wallet_id = wa.id
group by wa.id;
revoke all on public.owner_wallet_summary from anon, authenticated;
grant select on public.owner_wallet_summary to service_role;
