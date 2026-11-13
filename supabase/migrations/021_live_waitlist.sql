-- "Notify me when live trading opens" (owner approved 2026-11-12). One row per person who asked; leaving keeps the row with
-- left_at set, so the list of who wants the alert is exact and their choice is kept. Nothing here touches money or trading.
-- Backend only, like the rest of schema trading: row security on, no access for the app's database roles. A person joins or
-- leaves only for themselves, through POST/DELETE /trading/waitlist.
create table if not exists trading.live_waitlist (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  notified_at timestamptz,                  -- set once, when the alert about real-money trading has been sent
  check (left_at is null or left_at >= joined_at)
);

alter table trading.live_waitlist enable row level security;
revoke all on trading.live_waitlist from public, anon, authenticated;
grant all on trading.live_waitlist to service_role;
