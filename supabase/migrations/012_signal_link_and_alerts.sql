-- Signals: an exact link between a trade and the signal it came from, with the signal's time limit. Additive: other
-- trades keep nulls and behave as before. No foreign key to intel.ideas: the engine owns that schema.
alter table public.trades
  add column if not exists idea_id      bigint,
  add column if not exists idea_ends_at timestamptz;
alter table public.pending_orders
  add column if not exists idea_id      bigint,
  add column if not exists idea_ends_at timestamptz;
create index if not exists trades_user_idea_idx on public.trades (user_id, idea_id) where idea_id is not null;

-- Each alert goes out once, even after a restart.
create table if not exists public.signal_alerts (
  key     text primary key,
  sent_at timestamptz not null default now()
);

-- Where to deliver alerts when the app is closed: one row per browser or device that switched them on.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Backend only: no policies, so the app's own database role sees nothing.
alter table public.signal_alerts      enable row level security;
alter table public.push_subscriptions enable row level security;
