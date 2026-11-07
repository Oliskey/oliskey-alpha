-- New users learn before they trade (owner decision 2026-11-07): onboarded_at is set when they finish the lessons and the short check.
-- The server refuses their trades until then, and the AI does not trade for them. Additive: everyone who already has an account counts as finished.
alter table public.profiles add column if not exists onboarded_at timestamptz;
update public.profiles set onboarded_at = now() where onboarded_at is null;
