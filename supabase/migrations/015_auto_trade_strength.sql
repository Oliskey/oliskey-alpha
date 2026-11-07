-- Which trades the AI takes for a user: 'all' (most profit, the default) or 'strongest' (only its strongest signals: fewer trades, a higher win rate in tests, less total profit).
-- Owner decision 2026-11-07. Additive: every existing and new row stays on 'all' until the user changes it. The bar itself comes from intel/run_strength_test.py, not from this table.
alter table public.auto_trade_settings
  add column if not exists strength text not null default 'all' check (strength in ('all', 'strongest'));
