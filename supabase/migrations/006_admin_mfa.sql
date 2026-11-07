-- Admin 2-step login (audit 2026-10-30, owner rule "Admin must use 2-step login").
-- One TOTP secret per admin. Only the backend (service role / table owner) reads it; app users never can.

create table if not exists public.admin_mfa (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  secret         text not null,                -- base32 TOTP secret
  enabled_at     timestamptz,                  -- null until the first code is confirmed
  last_used_step bigint not null default 0,    -- last accepted 30-second step, so a code works once
  created_at     timestamptz not null default now()
);

alter table public.admin_mfa enable row level security;   -- no policies: no access for anon/authenticated
revoke all on public.admin_mfa from anon, authenticated;
