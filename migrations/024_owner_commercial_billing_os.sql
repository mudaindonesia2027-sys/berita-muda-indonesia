-- MUDA INDONESIA V19 — COMMERCIAL & BILLING OS
-- Additive only. Keeps V19 version unchanged.
create extension if not exists pgcrypto;

create table if not exists public.owner_ad_deals (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid references public.contact_inquiries(id) on delete set null,
  deal_number text not null unique,
  company text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  campaign_title text not null,
  placement text not null default 'website',
  start_date date,
  end_date date,
  amount numeric(20,2) not null default 0 check (amount >= 0),
  currency text not null default 'IDR',
  tax_mode text not null default 'none' check (tax_mode in ('none','withholding','ppn_external')),
  status text not null default 'draft' check (status in ('draft','proposed','approved','contracted','invoiced','partially_paid','paid','cancelled')),
  notes text,
  terms jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_ad_deals_status_time_idx on public.owner_ad_deals(status, created_at desc);
create index if not exists owner_ad_deals_company_idx on public.owner_ad_deals(lower(company));

create table if not exists public.owner_commercial_documents (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.owner_ad_deals(id) on delete cascade,
  doc_type text not null check (doc_type in ('quotation','order_confirmation','invoice','receipt','contract')),
  doc_number text not null unique,
  status text not null default 'draft' check (status in ('draft','issued','void')),
  issued_at timestamptz,
  due_at timestamptz,
  amount numeric(20,2) not null default 0,
  currency text not null default 'IDR',
  tax_note text,
  content jsonb not null default '{}'::jsonb,
  html_snapshot text,
  document_hash text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists owner_commercial_docs_deal_idx on public.owner_commercial_documents(deal_id, created_at desc);
create index if not exists owner_commercial_docs_type_idx on public.owner_commercial_documents(doc_type, created_at desc);

create table if not exists public.owner_commercial_payments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.owner_ad_deals(id) on delete cascade,
  document_id uuid references public.owner_commercial_documents(id) on delete set null,
  payment_reference text,
  amount numeric(20,2) not null check (amount > 0),
  currency text not null default 'IDR',
  paid_at timestamptz not null default now(),
  method text not null default 'bank_transfer',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists owner_commercial_payments_deal_idx on public.owner_commercial_payments(deal_id, paid_at desc);

create table if not exists public.owner_commercial_audit (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.owner_ad_deals(id) on delete set null,
  document_id uuid references public.owner_commercial_documents(id) on delete set null,
  event_key text not null,
  actor_id uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists owner_commercial_audit_time_idx on public.owner_commercial_audit(created_at desc);

create or replace function public.owner_commercial_touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists trg_owner_ad_deals_updated_at on public.owner_ad_deals;
create trigger trg_owner_ad_deals_updated_at before update on public.owner_ad_deals for each row execute function public.owner_commercial_touch_updated_at();
drop trigger if exists trg_owner_commercial_documents_updated_at on public.owner_commercial_documents;
create trigger trg_owner_commercial_documents_updated_at before update on public.owner_commercial_documents for each row execute function public.owner_commercial_touch_updated_at();

alter table public.owner_ad_deals enable row level security;
alter table public.owner_commercial_documents enable row level security;
alter table public.owner_commercial_payments enable row level security;
alter table public.owner_commercial_audit enable row level security;
revoke all on public.owner_ad_deals from anon, authenticated;
revoke all on public.owner_commercial_documents from anon, authenticated;
revoke all on public.owner_commercial_payments from anon, authenticated;
revoke all on public.owner_commercial_audit from anon, authenticated;
grant all on public.owner_ad_deals to service_role;
grant all on public.owner_commercial_documents to service_role;
grant all on public.owner_commercial_payments to service_role;
grant all on public.owner_commercial_audit to service_role;
