-- MUDA INDONESIA V19 — OWNER INBOX + CONTACT / ADVERTISER INQUIRIES
-- Additive only. Keeps V19 version unchanged.
create extension if not exists pgcrypto;

create table if not exists public.contact_inquiries (
  id uuid primary key default gen_random_uuid(),
  inquiry_type text not null default 'general' check (inquiry_type in ('general','iklan','sponsor','kerja_sama','koreksi','hak_cipta','lainnya')),
  name text not null,
  email text not null,
  phone text,
  company text,
  subject text,
  message text not null,
  budget numeric(20,2),
  currency text not null default 'IDR',
  status text not null default 'new' check (status in ('new','read','in_progress','replied','closed','spam')),
  source_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contact_inquiries_status_time_idx on public.contact_inquiries(status, created_at desc);
create index if not exists contact_inquiries_type_time_idx on public.contact_inquiries(inquiry_type, created_at desc);
create index if not exists contact_inquiries_email_idx on public.contact_inquiries(lower(email));

alter table public.contact_inquiries enable row level security;
revoke all on table public.contact_inquiries from anon, authenticated;
grant all on table public.contact_inquiries to service_role;

create or replace function public.contact_inquiries_touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists trg_contact_inquiries_updated_at on public.contact_inquiries;
create trigger trg_contact_inquiries_updated_at before update on public.contact_inquiries for each row execute function public.contact_inquiries_touch_updated_at();
