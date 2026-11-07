-- The AI trading for a user: each user chooses "always ask" or "auto trade", per kind of money, from a minimum of 100 per trade.
-- No row means the defaults, which live in the backend: demo trades automatically, real money always asks. Additive: other trades
-- keep auto = false and behave as before. Owner decision 2026-11-06. Real money never trades automatically while the real-money gate
-- is closed; a user's choice is only stored, with the moment they accepted the risk.
alter table public.trades
  add column if not exists auto boolean not null default false;

create table if not exists public.auto_trade_settings (
  user_id          uuid not null references public.profiles (id) on delete cascade,
  scope            text not null check (scope in ('demo', 'real')),
  mode             text not null check (mode in ('ask', 'auto')),
  amount           numeric(20, 2) not null default 100 check (amount >= 100),
  risk_accepted_at timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (user_id, scope)
);

-- Backend only: no policies, so the app's own database role sees nothing.
alter table public.auto_trade_settings enable row level security;
