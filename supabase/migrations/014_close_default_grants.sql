-- Hosted Supabase gives anon and authenticated full rights on every new table by default.
-- Row security already blocks them; this removes the rights too, so one mistake can't open a table.
revoke all on public.auto_trade_settings, public.funded_interest, public.pending_orders,
              public.push_subscriptions, public.referral_rewards, public.signal_alerts,
              public.user_boosts
  from anon, authenticated;

-- The read access migrations 008 and 010 intended. Row security limits each person to their own rows.
grant select on public.funded_interest, public.pending_orders,
                public.referral_rewards, public.user_boosts
  to authenticated;

-- Anything created later starts closed and must be granted on purpose.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
