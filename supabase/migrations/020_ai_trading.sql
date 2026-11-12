-- 020 · Oliskey AI Trading (exchange-connected, non-custodial). Owner approval: 2026-11-12 ("add new tables").
--
-- Customers trade spot BTC/USDT and ETH/USDT on THEIR OWN exchange accounts through API keys that can trade but never
-- withdraw. Oliskey never holds customer money. Oliskey earns a strategy subscription and 15% of eligible realised net
-- profit (high-water mark), invoiced and paid separately.
--
-- Everything lives in its own schema `trading`, next to the existing app (public.*), which this migration does not
-- change. The schema is not exposed by Supabase's Data API; the backend reaches it over its direct connection as
-- service_role. Row Level Security is still on for every customer-owned table (defence in depth), with read-only
-- policies for the owner. All money is NUMERIC; all times are timestamptz (UTC). Safe to run more than once.
-- Rollback: supabase/rollback/020_ai_trading_down.sql (drops the schema; no existing table is touched).

create schema if not exists trading;
revoke all on schema trading from public;
grant usage on schema trading to service_role, authenticated;

-- ───────────────────────── Platform controls ─────────────────────────
create table if not exists trading.controls (
  id boolean primary key default true check (id),            -- one row
  platform_paused boolean not null default false,
  emergency_stop boolean not null default false,
  live_trading_enabled boolean not null default false,        -- master switch; stays off until every approval is done
  reason text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into trading.controls (id) values (true) on conflict (id) do nothing;

-- ───────────────────────── Exchanges ─────────────────────────
create table if not exists trading.exchange_providers (
  id text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  name text not null,
  phase int not null check (phase between 1 and 99),
  website_url text,
  api_docs_url text,
  key_settings_url text,                                       -- where a customer creates / deletes an API key
  requires_passphrase boolean not null default false,
  adapter_status text not null default 'planned' check (adapter_status in ('planned', 'in_development', 'testing', 'passed')),
  live_enabled boolean not null default false,                  -- set only by the approval centre (all approvals done)
  jurisdictions text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists trading.exchange_capabilities (
  provider_id text not null references trading.exchange_providers(id) on delete cascade,
  capability text not null check (capability ~ '^[a-z_]{3,40}$'),
  supported boolean not null,
  notes text,
  primary key (provider_id, capability)
);

create table if not exists trading.exchange_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null references trading.exchange_providers(id),
  environment text not null check (environment in ('testnet', 'live')),
  label text check (char_length(label) <= 40),
  key_hint text not null check (char_length(key_hint) <= 12),   -- last 4 characters only, to recognise the key
  credentials_ciphertext text not null,                         -- AES-256-GCM, never returned by the API
  credentials_key_id text not null,                             -- which encryption key; allows rotation
  permissions jsonb not null default '{}',                      -- what the exchange reported at the last check
  status text not null default 'pending' check (status in ('pending', 'active', 'invalid', 'error', 'revoked')),
  status_detail text,
  last_verified_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists exchange_connections_one_active
  on trading.exchange_connections (user_id, provider_id, environment) where revoked_at is null;
create index if not exists exchange_connections_user on trading.exchange_connections (user_id);

create table if not exists trading.exchange_reconciliations (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references trading.exchange_connections(id) on delete cascade,
  run_at timestamptz not null default now(),
  status text not null check (status in ('ok', 'difference', 'failed')),
  balances jsonb not null default '{}',
  differences jsonb not null default '[]',
  detail text
);
create index if not exists exchange_reconciliations_conn on trading.exchange_reconciliations (connection_id, run_at desc);

-- ───────────────────────── Strategies ─────────────────────────
create table if not exists trading.trading_strategies (
  id text primary key check (id ~ '^[a-z_]{3,40}$'),
  name text not null,
  style text not null check (style in ('scalping', 'swing')),
  profile text not null check (profile in ('strict', 'balanced')),
  summary text not null,
  sort int not null default 0,
  active boolean not null default true
);

create table if not exists trading.strategy_versions (
  id uuid primary key default gen_random_uuid(),
  strategy_id text not null references trading.trading_strategies(id),
  version text not null check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  config jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'testing', 'approved_paper', 'approved_live', 'retired')),
  backtest jsonb,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (strategy_id, version),
  -- a version can only be approved with a recorded approver and test result
  check (status not in ('approved_paper', 'approved_live') or (approved_by is not null and approved_at is not null and backtest is not null))
);

create table if not exists trading.strategy_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_id text not null references trading.trading_strategies(id),
  status text not null default 'pending_payment' check (status in ('pending_payment', 'active', 'past_due', 'cancelled', 'expired')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  payment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'active' or (current_period_start is not null and current_period_end > current_period_start))
);
create unique index if not exists strategy_subscriptions_one_live
  on trading.strategy_subscriptions (user_id, strategy_id) where status in ('pending_payment', 'active', 'past_due');

create table if not exists trading.strategy_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_id text not null references trading.trading_strategies(id),
  connection_id uuid not null references trading.exchange_connections(id) on delete cascade,
  amount numeric(28, 8) not null check (amount >= 0),
  quote_asset text not null default 'USDT' check (quote_asset in ('USDT')),
  status text not null default 'active' check (status in ('active', 'paused')),
  updated_at timestamptz not null default now(),
  unique (user_id, strategy_id, connection_id)
);

create table if not exists trading.user_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  paused boolean not null default false,
  reason text,
  updated_at timestamptz not null default now()
);

-- ───────────────────────── Market data, signals, decisions ─────────────────────────
create table if not exists trading.market_data (
  source text not null,
  symbol text not null check (symbol in ('BTCUSDT', 'ETHUSDT')),
  interval text not null check (interval in ('1m', '5m', '15m', '1h', '4h', '1d')),
  open_time timestamptz not null,
  open numeric(28, 8) not null, high numeric(28, 8) not null, low numeric(28, 8) not null, close numeric(28, 8) not null,
  volume numeric(38, 8) not null,
  received_at timestamptz not null default now(),
  primary key (source, symbol, interval, open_time),
  check (high >= low and high >= open and high >= close and low <= open and low <= close and low > 0)
);

create table if not exists trading.trading_signals (
  id uuid primary key default gen_random_uuid(),
  strategy_version_id uuid not null references trading.strategy_versions(id),
  symbol text not null check (symbol in ('BTCUSDT', 'ETHUSDT')),
  side text not null check (side in ('buy', 'sell')),            -- long-only: sell only closes a holding
  reference_price numeric(28, 8) not null check (reference_price > 0),
  price_time timestamptz not null,
  stop_price numeric(28, 8),
  target_price numeric(28, 8),
  reasons jsonb not null default '{}',
  created_at timestamptz not null default now(),
  valid_until timestamptz not null,
  check (valid_until > created_at)
);
create index if not exists trading_signals_recent on trading.trading_signals (created_at desc);

create table if not exists trading.agent_decisions (
  id uuid primary key default gen_random_uuid(),
  agent text not null,
  strategy_id text references trading.trading_strategies(id),
  symbol text,
  decision text not null check (decision in ('trade', 'wait', 'skip', 'veto', 'info')),
  input jsonb not null default '{}',
  output jsonb not null default '{}',
  explanation text,
  signal_id uuid references trading.trading_signals(id),
  created_at timestamptz not null default now()
);
create index if not exists agent_decisions_recent on trading.agent_decisions (created_at desc);

-- ───────────────────────── Orders, fills, positions ─────────────────────────
create table if not exists trading.trading_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid references trading.exchange_connections(id) on delete set null,
  strategy_id text not null references trading.trading_strategies(id),
  signal_id uuid references trading.trading_signals(id),
  environment text not null check (environment in ('paper', 'testnet', 'live')),
  symbol text not null check (symbol in ('BTCUSDT', 'ETHUSDT')),
  side text not null check (side in ('buy', 'sell')),
  type text not null check (type in ('market', 'limit')),
  quantity numeric(28, 8) check (quantity > 0),
  quote_quantity numeric(28, 8) check (quote_quantity > 0),
  limit_price numeric(28, 8) check (limit_price > 0),
  idempotency_key text not null unique,                         -- the same key never creates a second order
  client_order_id text not null unique,                         -- sent to the exchange, so a retry finds the same order
  exchange_order_id text,
  status text not null default 'new' check (status in ('new', 'submitted', 'partially_filled', 'filled', 'cancelled', 'rejected', 'failed', 'unknown')),
  status_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (quantity is not null or quote_quantity is not null),
  check (type <> 'limit' or limit_price is not null)
);
create index if not exists trading_orders_user on trading.trading_orders (user_id, created_at desc);

create table if not exists trading.trade_fills (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references trading.trading_orders(id) on delete cascade,
  exchange_fill_id text not null,
  price numeric(28, 8) not null check (price > 0),
  quantity numeric(28, 8) not null check (quantity > 0),
  quote_quantity numeric(28, 8) not null check (quote_quantity > 0),
  fee numeric(28, 8) not null check (fee >= 0),
  fee_asset text not null,
  fee_quote numeric(28, 8) not null check (fee_quote >= 0),      -- the fee in USDT at the fill price (for profit)
  filled_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (order_id, exchange_fill_id)
);

create table if not exists trading.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid references trading.exchange_connections(id) on delete set null,
  strategy_id text not null references trading.trading_strategies(id),
  environment text not null check (environment in ('paper', 'testnet', 'live')),
  symbol text not null check (symbol in ('BTCUSDT', 'ETHUSDT')),
  quantity numeric(28, 8) not null default 0 check (quantity >= 0),   -- long-only: never below zero
  cost_basis numeric(28, 8) not null default 0 check (cost_basis >= 0),
  realised_pnl numeric(28, 8) not null default 0,
  fees_quote numeric(28, 8) not null default 0 check (fees_quote >= 0),
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);
-- one row per customer, strategy, environment and coin; realised_pnl there is a cumulative cache rebuilt from the fills
create unique index if not exists positions_one_row on trading.positions (user_id, strategy_id, environment, symbol);

-- ───────────────────────── Risk ─────────────────────────
create table if not exists trading.risk_limits (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('platform', 'user', 'strategy')),
  scope_id text not null default '*',
  max_order_quote numeric(28, 8) not null check (max_order_quote > 0),
  max_position_quote numeric(28, 8) not null check (max_position_quote > 0),
  max_daily_loss_quote numeric(28, 8) not null check (max_daily_loss_quote > 0),
  max_exposure_pct numeric(5, 2) not null check (max_exposure_pct > 0 and max_exposure_pct <= 100),
  max_concurrent_positions int not null check (max_concurrent_positions between 1 and 20),
  max_slippage_bps int not null check (max_slippage_bps between 1 and 500),
  max_price_age_ms int not null check (max_price_age_ms between 500 and 120000),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (scope, scope_id)
);
insert into trading.risk_limits (scope, scope_id, max_order_quote, max_position_quote, max_daily_loss_quote, max_exposure_pct,
  max_concurrent_positions, max_slippage_bps, max_price_age_ms)
values ('platform', '*', 1000, 5000, 250, 80, 4, 30, 5000)
on conflict (scope, scope_id) do nothing;

create table if not exists trading.risk_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  strategy_id text,
  symbol text,
  decision text not null check (decision in ('approved', 'rejected', 'paused', 'stopped')),
  rules jsonb not null default '[]',                            -- every check with its outcome
  proposal jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists risk_events_recent on trading.risk_events (created_at desc);

-- ───────────────────────── Profit, high-water mark, commission ─────────────────────────
create table if not exists trading.profit_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null check (environment in ('paper', 'testnet', 'live')),
  as_of timestamptz not null default now(),
  starting_capital numeric(28, 8) not null check (starting_capital >= 0),   -- exchange-reported, not money Oliskey holds
  exchange_balance numeric(28, 8) not null check (exchange_balance >= 0),
  realised_net_pnl numeric(28, 8) not null,
  unrealised_pnl numeric(28, 8) not null,
  fees_quote numeric(28, 8) not null check (fees_quote >= 0),
  source text not null check (source in ('reconciliation', 'fills'))
);
create index if not exists profit_snapshots_user on trading.profit_snapshots (user_id, as_of desc);

create table if not exists trading.high_water_marks (
  user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null check (environment in ('live')),     -- commission applies to live money only
  level numeric(28, 8) not null default 0 check (level >= 0),    -- cumulative realised net profit already charged
  updated_at timestamptz not null default now(),
  primary key (user_id, environment)
);

create sequence if not exists trading.invoice_number_seq;
create table if not exists trading.commission_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  number text not null unique default ('OAT-' || to_char(now() at time zone 'utc', 'YYYY') || '-' || lpad(nextval('trading.invoice_number_seq')::text, 6, '0')),
  realised_net_profit numeric(28, 8) not null,                  -- cumulative, at the time of the invoice
  previous_hwm numeric(28, 8) not null check (previous_hwm >= 0),
  new_hwm numeric(28, 8) not null check (new_hwm >= previous_hwm),
  eligible_profit numeric(28, 8) not null check (eligible_profit > 0),
  rate numeric(5, 4) not null default 0.15 check (rate = 0.15),
  commission numeric(28, 2) not null check (commission > 0),
  customer_share numeric(28, 8) not null check (customer_share >= 0),
  currency text not null default 'USD' check (currency in ('USD')),
  status text not null default 'issued' check (status in ('issued', 'paid', 'void')),
  declaration jsonb,                                            -- the customer's withdrawal declaration
  issued_at timestamptz not null default now(),
  paid_at timestamptz,
  check (eligible_profit = new_hwm - previous_hwm),
  check (status <> 'paid' or paid_at is not null)
);
create index if not exists commission_invoices_user on trading.commission_invoices (user_id, issued_at desc);

create table if not exists trading.commission_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references trading.commission_invoices(id),
  provider text not null check (provider in ('paystack', 'stripe')),
  reference text not null unique,
  amount numeric(28, 2) not null check (amount > 0),
  currency text not null check (currency in ('NGN', 'USD')),
  fx_rate numeric(18, 6),                                       -- NGN per USD used for the checkout, when NGN
  status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'success' or verified_at is not null)
);
create unique index if not exists commission_payments_one_success on trading.commission_payments (invoice_id) where status = 'success';

create table if not exists trading.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('paystack', 'stripe')),
  reference text not null unique,
  strategies text[] not null check (cardinality(strategies) between 1 and 4),
  amount_usd numeric(10, 2) not null check (amount_usd > 0),
  amount numeric(28, 2) not null check (amount > 0),
  currency text not null check (currency in ('NGN', 'USD')),
  fx_rate numeric(18, 6),
  status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'success' or verified_at is not null)
);

-- Oliskey's own books (subscriptions and commission), double entry. Rows are never changed or deleted.
create table if not exists trading.account_ledger (
  id bigint generated always as identity primary key,
  entry_id uuid not null,
  account text not null check (account in ('cash_paystack', 'cash_stripe', 'revenue_subscriptions', 'revenue_commission', 'receivable_commission')),
  debit numeric(28, 2) not null default 0 check (debit >= 0),
  credit numeric(28, 2) not null default 0 check (credit >= 0),
  currency text not null check (currency in ('NGN', 'USD')),
  memo text not null,
  ref_type text not null,
  ref_id uuid not null,
  created_at timestamptz not null default now(),
  check ((debit > 0) <> (credit > 0))
);
create index if not exists account_ledger_entry on trading.account_ledger (entry_id);

-- ───────────────────────── Approvals, audit, events ─────────────────────────
create table if not exists trading.admin_approvals (
  id uuid primary key default gen_random_uuid(),
  area text not null check (area in ('exchange_commercial', 'regulatory_legal', 'api_integration', 'security_assessment',
    'penetration_test', 'payment_provider', 'production_environment', 'live_trading_activation')),
  subject text not null default 'platform',                     -- 'platform' or an exchange id
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'submitted', 'approved', 'rejected')),
  evidence_url text,
  evidence_note text,
  responsible text,
  required_action text,
  link_url text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (area, subject),
  -- never complete without evidence
  check (status <> 'approved' or (coalesce(evidence_url, '') <> '' and coalesce(evidence_note, '') <> '' and updated_by is not null))
);

create table if not exists trading.admin_approval_history (
  id bigint generated always as identity primary key,
  approval_id uuid not null references trading.admin_approvals(id) on delete cascade,
  status text not null,
  evidence_url text,
  evidence_note text,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create table if not exists trading.security_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target text,
  ip inet,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists security_audit_logs_recent on trading.security_audit_logs (created_at desc);

create table if not exists trading.system_events (
  id bigint generated always as identity primary key,
  kind text not null,
  severity text not null check (severity in ('info', 'warning', 'error', 'critical')),
  message text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Append-only records: fills, ledger, risk events, agent decisions, audit logs, approval history.
create or replace function trading.append_only() returns trigger language plpgsql as $$
begin
  raise exception 'APPEND_ONLY: % rows cannot be changed or deleted', tg_table_name;
end $$;
do $$
declare t text;
begin
  foreach t in array array['trade_fills', 'account_ledger', 'risk_events', 'agent_decisions', 'security_audit_logs', 'admin_approval_history'] loop
    execute format('drop trigger if exists %I_append_only on trading.%I', t, t);
    execute format('create trigger %I_append_only before update or delete on trading.%I for each row execute function trading.append_only()', t, t);
    execute format('drop trigger if exists %I_no_truncate on trading.%I', t, t);
    execute format('create trigger %I_no_truncate before truncate on trading.%I for each statement execute function trading.append_only()', t, t);
  end loop;
end $$;

-- Every ledger entry must balance (debits = credits per currency), checked when the transaction commits.
create or replace function trading.ledger_balanced() returns trigger language plpgsql as $$
begin
  if exists (select 1 from trading.account_ledger where entry_id = new.entry_id
             group by currency having sum(debit) <> sum(credit)) then
    raise exception 'LEDGER_UNBALANCED: entry % does not balance', new.entry_id;
  end if;
  return null;
end $$;
drop trigger if exists account_ledger_balanced on trading.account_ledger;
create constraint trigger account_ledger_balanced after insert on trading.account_ledger
  deferrable initially deferred for each row execute function trading.ledger_balanced();

-- Every approval change is kept in the history.
create or replace function trading.approval_history() returns trigger language plpgsql as $$
begin
  insert into trading.admin_approval_history (approval_id, status, evidence_url, evidence_note, changed_by)
  values (new.id, new.status, new.evidence_url, new.evidence_note, new.updated_by);
  return null;
end $$;
drop trigger if exists admin_approvals_history on trading.admin_approvals;
create trigger admin_approvals_history after insert or update on trading.admin_approvals
  for each row execute function trading.approval_history();

-- An exchange can go live only when every approval for it AND for the platform is approved with evidence.
create or replace function trading.guard_live_exchange() returns trigger language plpgsql as $$
begin
  if new.live_enabled and not old.live_enabled then
    if new.adapter_status <> 'passed' then raise exception 'LIVE_NOT_ALLOWED: adapter tests have not passed'; end if;
    if exists (
      select 1 from (values ('exchange_commercial'), ('api_integration'), ('security_assessment')) req(area)
      where not exists (select 1 from trading.admin_approvals a where a.area = req.area and a.subject = new.id and a.status = 'approved')
    ) or exists (
      select 1 from (values ('regulatory_legal'), ('penetration_test'), ('payment_provider'), ('production_environment'), ('live_trading_activation')) req(area)
      where not exists (select 1 from trading.admin_approvals a where a.area = req.area and a.subject = 'platform' and a.status = 'approved')
    ) then
      raise exception 'LIVE_NOT_ALLOWED: approvals are missing';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists exchange_providers_live_guard on trading.exchange_providers;
create trigger exchange_providers_live_guard before update on trading.exchange_providers
  for each row execute function trading.guard_live_exchange();

create or replace function trading.guard_live_switch() returns trigger language plpgsql as $$
begin
  if new.live_trading_enabled and not old.live_trading_enabled and not exists (
    select 1 from trading.exchange_providers where live_enabled
  ) then
    raise exception 'LIVE_NOT_ALLOWED: no exchange is approved for live trading';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists controls_live_guard on trading.controls;
create trigger controls_live_guard before update on trading.controls for each row execute function trading.guard_live_switch();

-- ───────────────────────── Seed: exchanges, capabilities, strategies, approvals ─────────────────────────
insert into trading.exchange_providers (id, name, phase, website_url, api_docs_url, key_settings_url, requires_passphrase, adapter_status) values
  ('binance', 'Binance', 1, 'https://www.binance.com', 'https://developers.binance.com/docs/binance-spot-api-docs', 'https://www.binance.com/en/my/settings/api-management', false, 'in_development'),
  ('okx', 'OKX', 2, 'https://www.okx.com', 'https://www.okx.com/docs-v5/en/', 'https://www.okx.com/account/my-api', true, 'planned'),
  ('bybit', 'Bybit', 3, 'https://www.bybit.com', 'https://bybit-exchange.github.io/docs/v5/intro', 'https://www.bybit.com/app/user/api-management', false, 'planned'),
  ('kucoin', 'KuCoin', 4, 'https://www.kucoin.com', 'https://www.kucoin.com/docs-new', 'https://www.kucoin.com/account/api', true, 'planned'),
  ('gateio', 'Gate.io', 5, 'https://www.gate.io', 'https://www.gate.io/docs/developers/apiv4/', 'https://www.gate.io/myaccount/apikeys', false, 'planned')
on conflict (id) do nothing;

insert into trading.exchange_capabilities (provider_id, capability, supported, notes)
select 'binance', c, true, null from unnest(array['spot_market_order', 'spot_limit_order', 'cancel_order', 'order_status', 'fills',
  'balances', 'klines', 'order_book', 'trading_fees', 'key_permissions_check', 'client_order_id', 'testnet']) c
on conflict do nothing;

insert into trading.trading_strategies (id, name, style, profile, summary, sort) values
  ('strict_scalping', 'Strict Scalping', 'scalping', 'strict', 'Short trades only in the clearest conditions. Fewer trades, tighter risk.', 1),
  ('balanced_scalping', 'Balanced Scalping', 'scalping', 'balanced', 'Short trades in clear and moderate conditions.', 2),
  ('strict_swing', 'Strict Swing', 'swing', 'strict', 'Trades held hours to days, only on strong confirmed trends.', 3),
  ('balanced_swing', 'Balanced Swing', 'swing', 'balanced', 'Trades held hours to days on confirmed trends.', 4)
on conflict (id) do nothing;

insert into trading.admin_approvals (area, subject, required_action, link_url)
select a, 'platform', r, l from (values
  ('regulatory_legal', 'Written opinion from a Nigerian capital-markets lawyer on whether the service is regulated (SEC Nigeria, virtual-asset rules) and which licences apply.', 'https://sec.gov.ng'),
  ('penetration_test', 'Independent penetration test of the app, API and infrastructure; all critical and high findings fixed and retested.', null),
  ('payment_provider', 'Paystack live account approved for subscriptions and commission payments.', 'https://dashboard.paystack.com'),
  ('production_environment', 'Hosted Supabase project, production secrets, backups and monitoring verified.', null),
  ('live_trading_activation', 'Final sign-off by the CEO after every other approval is complete.', null)
) v(a, r, l)
on conflict (area, subject) do nothing;

insert into trading.admin_approvals (area, subject, required_action, link_url)
select a, p.id, r, p.api_docs_url from trading.exchange_providers p cross join (values
  ('exchange_commercial', 'Written permission from the exchange to run a third-party trading service for its customers (broker / partner programme).'),
  ('api_integration', 'Adapter passes the automated tests and a supervised test on the exchange''s testnet.'),
  ('security_assessment', 'Review of key storage, permission checks and order handling for this exchange.')
) v(a, r)
on conflict (area, subject) do nothing;

-- ───────────────────────── Row Level Security ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['controls', 'exchange_providers', 'exchange_capabilities', 'exchange_connections', 'exchange_reconciliations',
    'trading_strategies', 'strategy_versions', 'strategy_subscriptions', 'strategy_allocations', 'user_controls', 'market_data',
    'trading_signals', 'agent_decisions', 'trading_orders', 'trade_fills', 'positions', 'risk_limits', 'risk_events',
    'profit_snapshots', 'high_water_marks', 'commission_invoices', 'commission_payments', 'subscription_payments', 'account_ledger',
    'admin_approvals', 'admin_approval_history', 'security_audit_logs', 'system_events'] loop
    execute format('alter table trading.%I enable row level security', t);
    execute format('revoke all on trading.%I from public, anon, authenticated', t);
    execute format('grant all on trading.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema trading to service_role;

-- Read-only access for signed-in customers to their own rows (the backend is still the normal path).
do $$
declare t text;
begin
  foreach t in array array['strategy_subscriptions', 'strategy_allocations', 'user_controls', 'trading_orders', 'positions',
    'profit_snapshots', 'high_water_marks', 'commission_invoices', 'subscription_payments'] loop
    execute format('grant select on trading.%I to authenticated', t);
    execute format('drop policy if exists own_rows on trading.%I', t);
    execute format('create policy own_rows on trading.%I for select to authenticated using (user_id = auth.uid())', t);
  end loop;
end $$;
-- Connections: customers may see their own, but never the encrypted key (column-level grant leaves it out).
grant select (id, user_id, provider_id, environment, label, key_hint, permissions, status, status_detail, last_verified_at,
  last_sync_at, created_at, revoked_at) on trading.exchange_connections to authenticated;
drop policy if exists own_rows on trading.exchange_connections;
create policy own_rows on trading.exchange_connections for select to authenticated using (user_id = auth.uid());
-- Public catalogue
do $$
declare t text;
begin
  foreach t in array array['exchange_providers', 'exchange_capabilities', 'trading_strategies'] loop
    execute format('grant select on trading.%I to authenticated', t);
    execute format('drop policy if exists catalogue on trading.%I', t);
    execute format('create policy catalogue on trading.%I for select to authenticated using (true)', t);
  end loop;
end $$;
