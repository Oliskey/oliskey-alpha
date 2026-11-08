-- Each user's app settings follow them to any phone or computer they sign in on (owner decision 2026-11-08: all of them):
-- theme, chart type and timeframe, indicators, drawings, market tabs, favourites, drawing options, trade panel, tips seen.
-- Display settings only: nothing here touches money, trades or the AI's choices (those have their own tables).
create table if not exists public.user_settings (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  prefs      jsonb not null default '{}'::jsonb check (jsonb_typeof(prefs) = 'object'),
  updated_at timestamptz not null default now()
);

-- Backend only: no policies, so the app's own database role sees nothing.
alter table public.user_settings enable row level security;
revoke all on public.user_settings from anon, authenticated;
