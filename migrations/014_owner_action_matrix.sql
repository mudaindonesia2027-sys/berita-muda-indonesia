-- MUDA INDONESIA V10.2 — UNIFIED OWNER ACTION MATRIX + EXECUTOR SECURITY
-- Expands the Owner Command Center from the initial 12 actions into a broad,
-- permission-aware operating matrix. Additive only.

alter table public.owner_action_registry
  add column if not exists min_role text not null default 'owner';

alter table public.owner_action_registry
  drop constraint if exists owner_action_registry_min_role_chk;
alter table public.owner_action_registry
  add constraint owner_action_registry_min_role_chk
  check (min_role in ('admin','owner','super_admin'));

create index if not exists owner_action_registry_category_idx
  on public.owner_action_registry(category, enabled);

insert into public.owner_action_registry
(action_key,display_name,category,description,risk_level,requires_confirmation,enabled,capabilities,min_role)
values
('create_article','Buat artikel','editorial','Buat draft artikel baru.','medium',false,true,'["editorial","seo"]','owner'),
('edit_article','Edit artikel','editorial','Edit field artikel yang diizinkan.','medium',false,true,'["editorial","seo","revisions"]','owner'),
('schedule_article','Schedule artikel','editorial','Jadwalkan artikel untuk dipublikasikan.','high',true,true,'["editorial","scheduler"]','owner'),
('restore_article','Restore artikel','editorial','Kembalikan artikel dari archived ke draft/published.','medium',true,true,'["editorial","recovery"]','owner'),
('bulk_article_status','Bulk status artikel','editorial','Ubah status banyak artikel dengan satu command.','high',true,true,'["editorial","bulk"]','owner'),
('create_video','Buat video','media','Buat draft video baru.','medium',false,true,'["media"]','owner'),
('edit_video','Edit video','media','Edit metadata video yang diizinkan.','medium',false,true,'["media","seo","revisions"]','owner'),
('archive_video','Arsipkan video','media','Arsipkan video.','medium',true,true,'["media"]','owner'),
('restore_video','Restore video','media','Restore video dari archived ke draft/published.','medium',true,true,'["media","recovery"]','owner'),
('set_video_visibility','Ubah visibilitas video','media','Ubah public/private video.','high',true,true,'["media","security"]','owner'),
('set_thumbnail','Set thumbnail media','media','Ubah thumbnail image URL.','low',false,true,'["media"]','owner'),
('create_homepage_layout','Buat homepage layout','homepage','Buat layout homepage draft.','medium',false,true,'["homepage"]','owner'),
('edit_homepage_layout','Edit homepage layout','homepage','Edit konfigurasi dan item homepage.','medium',false,true,'["homepage"]','owner'),
('archive_homepage','Arsipkan homepage layout','homepage','Arsipkan layout homepage.','medium',true,true,'["homepage"]','owner'),
('reorder_homepage','Reorder homepage','homepage','Atur ulang posisi item homepage.','medium',false,true,'["homepage"]','owner'),
('approve_breaking','Approve breaking','newsroom','Setujui kandidat breaking menjadi aktif.','high',true,true,'["breaking","newsroom"]','owner'),
('reject_breaking','Reject breaking','newsroom','Tolak kandidat breaking.','medium',true,true,'["breaking","newsroom"]','owner'),
('extend_breaking','Extend breaking','newsroom','Perpanjang breaking aktif.','high',true,true,'["breaking"]','owner'),
('rebuild_intelligence','Rebuild intelligence','intelligence','Bangun ulang article intelligence.','medium',false,true,'["intelligence"]','owner'),
('rebuild_trending','Rebuild trending','intelligence','Bangun ulang trending content.','medium',false,true,'["trending"]','owner'),
('rebuild_live_events','Rebuild live events','intelligence','Bangun ulang event intelligence.','medium',false,true,'["events"]','owner'),
('refresh_recommendations','Refresh recommendations','intelligence','Bangun ulang recommendation foundation.','medium',false,true,'["recommendation"]','owner'),
('analyze_seo','Analyze SEO','seo','Analisis readiness SEO konten.','low',false,true,'["seo"]','admin'),
('edit_seo','Edit SEO metadata','seo','Edit metadata SEO artikel/video.','medium',false,true,'["seo"]','owner'),
('set_canonical','Set canonical URL','seo','Set canonical URL konten.','high',true,true,'["seo"]','owner'),
('set_indexing','Index/noindex content','seo','Atur status index/noindex konten.','high',true,true,'["seo"]','owner'),
('rebuild_sitemap','Rebuild sitemap','seo','Bangun ulang sitemap jika endpoint tersedia.','medium',false,true,'["seo","system"]','owner'),
('approve_comment','Approve comment','community','Setujui komentar.','medium',true,true,'["community"]','owner'),
('hide_comment','Hide comment','community','Sembunyikan komentar.','medium',true,true,'["community"]','owner'),
('block_comment','Block comment','community','Blokir komentar.','medium',true,true,'["community","reputation"]','owner'),
('refresh_reputation','Refresh reputation','community','Refresh user reputation dari aturan sistem.','medium',false,true,'["community","reputation"]','owner'),
('broadcast_newsletter','Broadcast newsletter','audience','Siapkan atau jalankan broadcast newsletter.','high',true,true,'["newsletter"]','owner'),
('create_ad_campaign','Buat ad campaign','money','Buat campaign iklan.','high',true,true,'["ads","revenue"]','owner'),
('toggle_ad_campaign','Aktif/nonaktif ad campaign','money','Ubah status campaign iklan.','high',true,true,'["ads","revenue"]','owner'),
('record_revenue','Catat revenue','money','Catat pemasukan ke revenue_entries.','medium',false,true,'["revenue"]','owner'),
('create_wallet','Buat wallet internal','money','Buat akun wallet bookkeeping internal.','high',true,true,'["wallet"]','owner'),
('record_wallet_transaction','Catat transaksi wallet','money','Catat transaksi credit/debit.','high',true,true,'["wallet","reconciliation"]','owner'),
('reconcile_wallet','Rekonsiliasi wallet','money','Buat snapshot rekonsiliasi wallet.','high',true,true,'["wallet","reconciliation"]','owner'),
('request_payout','Request payout','money','Buat permintaan payout.','high',true,true,'["wallet","payout"]','owner'),
('approve_payout','Approve payout','money','Setujui payout.','critical',true,true,'["wallet","payout"]','super_admin'),
('mark_payout_paid','Mark payout paid','money','Tandai payout sebagai paid.','critical',true,true,'["wallet","payout"]','super_admin'),
('create_automation_rule','Buat automation rule','automation','Buat rule automation.','high',true,true,'["automation"]','owner'),
('toggle_automation_rule','Aktif/nonaktif automation','automation','Ubah enabled automation rule.','high',true,true,'["automation"]','owner'),
('run_automation','Jalankan automation','automation','Eksekusi satu automation run.','high',true,true,'["automation"]','owner'),
('cancel_automation','Batalkan automation run','automation','Batalkan run automation aktif.','medium',true,true,'["automation"]','owner'),
('test_source','Test source','operations','Tes source RSS tanpa mengubah status produksi.','low',false,true,'["rss","reliability"]','admin'),
('retry_source','Retry source','operations','Aktifkan kembali source dan tandai untuk retry.','medium',false,true,'["rss","reliability"]','owner'),
('reset_source_circuit','Reset source circuit','operations','Reset failure state source.','high',true,true,'["rss","reliability"]','owner'),
('run_health_check','Run health check','operations','Jalankan pemeriksaan sistem.','low',false,true,'["health"]','admin'),
('recover_system','System recovery','operations','Jalankan rebuild recovery yang aman.','high',true,true,'["recovery","system"]','owner'),
('resolve_task','Resolve task','governance','Tandai owner task selesai.','low',false,true,'["tasks"]','owner'),
('restore_revision','Restore revision','governance','Restore konten dari revision.','high',true,true,'["revisions","recovery"]','owner'),
('provider_health_check','Provider health check','governance','Periksa provider dari status dan metadata yang tersimpan.','low',false,true,'["providers"]','admin'),
('provider_state_change','Ubah provider state','governance','Ubah state provider dengan audit.','high',true,true,'["providers"]','owner'),
('change_admin_role','Ubah admin role','security','Ubah role admin.','critical',true,true,'["security","admins"]','super_admin'),
('deactivate_admin','Nonaktifkan admin','security','Nonaktifkan admin.','critical',true,true,'["security","admins"]','super_admin'),
('revoke_admin_sessions','Revoke admin sessions','security','Revoke session admin bila provider/auth API mendukung.','critical',true,true,'["security","sessions"]','super_admin'),
('emergency_stop_automation','Emergency stop automation','security','Matikan seluruh automation aktif.','critical',true,true,'["automation","security"]','super_admin')
on conflict (action_key) do update set
  display_name=excluded.display_name,
  category=excluded.category,
  description=excluded.description,
  risk_level=excluded.risk_level,
  requires_confirmation=excluded.requires_confirmation,
  enabled=excluded.enabled,
  capabilities=excluded.capabilities,
  min_role=excluded.min_role,
  updated_at=now();

-- Harden the original actions as well.
update public.owner_action_registry set min_role='super_admin', risk_level='critical', requires_confirmation=true where action_key in ('approve_payout','mark_payout_paid','change_admin_role','deactivate_admin','revoke_admin_sessions','emergency_stop_automation');

create table if not exists public.owner_command_execution_locks (
  command_id uuid primary key references public.owner_commands(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.owner_command_execution_locks enable row level security;
revoke all on public.owner_command_execution_locks from anon, authenticated;
grant all on public.owner_command_execution_locks to service_role;

create or replace function public.owner_role_level(p_role text)
returns integer
language sql
immutable
as $$
  select case p_role when 'super_admin' then 3 when 'owner' then 2 when 'admin' then 1 else 0 end;
$$;
