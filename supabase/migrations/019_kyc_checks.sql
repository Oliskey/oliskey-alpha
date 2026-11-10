-- Identity checks (owner decision 2026-11-10): a user proves who they are with Paystack's BVN + bank account match.
-- The BVN goes straight to Paystack and is never stored here. One row per attempt; profiles.kyc_status holds the outcome.
create table if not exists public.kyc_checks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  customer_code  text not null,
  first_name     text not null,
  last_name      text not null,
  bank_code      text not null,
  account_last4  text not null check (account_last4 ~ '^\d{4}$'),
  status         text not null default 'pending' check (status in ('pending', 'verified', 'failed')),
  reason         text,
  created_at     timestamptz not null default now(),
  decided_at     timestamptz
);
create index if not exists kyc_checks_user on public.kyc_checks (user_id, created_at desc);
create index if not exists kyc_checks_pending on public.kyc_checks (customer_code) where status = 'pending';

-- Backend only: no policies, so the app's own database role sees nothing.
alter table public.kyc_checks enable row level security;
revoke all on public.kyc_checks from anon, authenticated;
