-- Oliskey Alpha schema.
-- Money rules:
--  * Users can read only their own rows and can never write balances, trades or transactions.
--  * Balances change only through the SECURITY DEFINER functions below, executable by service_role only.
--  * Every function locks the account row (FOR UPDATE), so concurrent trades can never overspend.
--  * Win/loss and payout math is computed here from server-supplied quotes, never by the app.

create extension if not exists pgcrypto;

-- ───────────────────────── Types ─────────────────────────
create type public.account_type    as enum ('DEMO', 'NGN', 'USDT');
create type public.user_tier       as enum ('starter', 'smart', 'alpha');
create type public.kyc_status      as enum ('none', 'pending', 'verified', 'rejected');
create type public.asset_category  as enum ('currency', 'commodity', 'index', 'crypto', 'stock');
create type public.trade_mode      as enum ('fixed_time', 'inzone', 'forex');
create type public.trade_direction as enum ('up', 'down');
create type public.trade_status    as enum ('open', 'closed');
create type public.trade_result    as enum ('win', 'loss', 'refund');
create type public.tx_type         as enum ('deposit', 'withdrawal', 'stake', 'payout', 'refund', 'bonus', 'task_reward', 'demo_reset');
create type public.tx_status       as enum ('pending', 'completed', 'failed', 'rejected');
create type public.task_kind       as enum ('win_streak', 'trade_count');
create type public.user_task_status as enum ('available', 'accepted', 'completed', 'expired');
create type public.notification_category as enum ('rewards', 'transactions', 'activities', 'platform', 'education');

-- ───────────────────────── Tables ─────────────────────────
create table public.platform_settings (
  id                   boolean primary key default true check (id),
  live_trading_enabled boolean       not null default false,
  demo_start_balance   numeric(20,2) not null default 10000 check (demo_start_balance > 0),
  min_deposit_ngn      numeric(20,2) not null default 1000,
  min_withdrawal_ngn   numeric(20,2) not null default 1000,
  updated_at           timestamptz   not null default now()
);

create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  full_name         text,
  phone             text,
  tier              public.user_tier  not null default 'starter',
  kyc_status        public.kyc_status not null default 'none',
  active_account_id uuid,
  is_admin          boolean not null default false,
  created_at        timestamptz not null default now()
);

create table public.accounts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       public.account_type not null,
  currency   text not null,
  balance    numeric(20,2) not null default 0 check (balance >= 0),
  locked     numeric(20,2) not null default 0 check (locked >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, type)
);

alter table public.profiles
  add constraint profiles_active_account_fk
  foreign key (active_account_id) references public.accounts (id) on delete set null;

create table public.assets (
  id            text primary key,
  name          text not null,
  category      public.asset_category not null,
  base_price    numeric(20,8) not null check (base_price > 0),
  decimals      int  not null check (decimals between 0 and 8),
  volatility    numeric(12,8) not null check (volatility > 0),   -- std-dev of one 250 ms tick, as a fraction of price
  payout_fixed  numeric(5,2) not null check (payout_fixed between 0 and 200),
  payout_inzone numeric(5,2) not null check (payout_inzone between 0 and 300),
  max_leverage  int  not null default 1 check (max_leverage >= 1),
  is_active     boolean not null default true,
  sort_order    int  not null default 0
);

create table public.trades (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  account_id    uuid not null references public.accounts (id) on delete cascade,
  asset_id      text not null references public.assets (id),
  mode          public.trade_mode not null,
  direction     public.trade_direction,
  amount        numeric(20,2) not null check (amount > 0),
  payout_pct    numeric(5,2),
  zone_pct      numeric(10,6),
  leverage      int,
  take_profit   numeric(20,8),
  stop_loss     numeric(20,8),
  duration_sec  int,
  open_quote    numeric(20,8) not null,
  open_time     timestamptz   not null default now(),
  expires_at    timestamptz,
  close_quote   numeric(20,8),
  close_time    timestamptz,
  status        public.trade_status not null default 'open',
  result        public.trade_result,
  pnl           numeric(20,2),
  return_amount numeric(20,2),
  constraint trades_mode_shape check (
    (mode = 'fixed_time' and direction is not null and duration_sec between 5 and 14400 and leverage is null)
    or (mode = 'inzone' and direction is null and duration_sec between 5 and 14400 and zone_pct > 0 and leverage is null)
    or (mode = 'forex' and direction is not null and duration_sec is null and leverage >= 1)
  )
);
create index trades_user_time_idx on public.trades (user_id, open_time desc);
create index trades_open_idx      on public.trades (status) where status = 'open';

create table public.quote_ticks (
  trade_id uuid not null references public.trades (id) on delete cascade,
  ts       timestamptz   not null,
  price    numeric(20,8) not null,
  primary key (trade_id, ts)
);

create table public.payout_methods (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  kind           text not null check (kind in ('bank', 'wallet')),
  bank_code      text,
  bank_name      text,
  account_number text,
  account_name   text,
  wallet_address text,
  network        text,
  recipient_code text,              -- Paystack transfer recipient
  is_default     boolean not null default false,
  created_at     timestamptz not null default now()
);

create table public.transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  account_id    uuid not null references public.accounts (id) on delete cascade,
  type          public.tx_type   not null,
  status        public.tx_status not null default 'completed',
  amount        numeric(20,2) not null,           -- signed change to balance (+ credit, - debit)
  balance_after numeric(20,2),
  reference     text unique,                      -- Paystack reference / idempotency key
  trade_id      uuid references public.trades (id) on delete set null,
  payout_method_id uuid references public.payout_methods (id) on delete set null,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index transactions_user_time_idx on public.transactions (user_id, created_at desc);

create table public.promo_codes (
  code        text primary key,
  description text not null,
  bonus_pct   numeric(5,2)  not null check (bonus_pct > 0),
  max_bonus   numeric(20,2) not null check (max_bonus > 0),
  min_deposit numeric(20,2) not null default 0,
  max_uses    int,
  uses        int not null default 0,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  is_active   boolean not null default true
);

create table public.tasks (
  id            text primary key,
  title         text not null,
  kind          public.task_kind not null,
  target        int  not null check (target > 0),
  reward        numeric(20,2) not null check (reward > 0),   -- credited to the DEMO account
  asset_id      text references public.assets (id),           -- null = any asset
  mode          public.trade_mode,                            -- null = any mode
  time_limit_sec int not null default 10800,                  -- countdown after accepting
  is_active     boolean not null default true,
  sort_order    int not null default 0
);

create table public.user_tasks (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  task_id      text not null references public.tasks (id) on delete cascade,
  status       public.user_task_status not null default 'available',
  progress     int not null default 0,
  accepted_at  timestamptz,
  expires_at   timestamptz,
  completed_at timestamptz,
  primary key (user_id, task_id)
);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  category   public.notification_category not null,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_time_idx on public.notifications (user_id, created_at desc);

-- ───────────────────────── Row Level Security ─────────────────────────
alter table public.platform_settings enable row level security;
alter table public.profiles          enable row level security;
alter table public.accounts          enable row level security;
alter table public.assets            enable row level security;
alter table public.trades            enable row level security;
alter table public.quote_ticks       enable row level security;
alter table public.payout_methods    enable row level security;
alter table public.transactions      enable row level security;
alter table public.promo_codes       enable row level security;
alter table public.tasks             enable row level security;
alter table public.user_tasks        enable row level security;
alter table public.notifications     enable row level security;

-- Start from nothing, then grant only reads (plus three narrow user updates).
revoke all on all tables in schema public from anon, authenticated;

grant select on public.platform_settings, public.assets, public.tasks, public.promo_codes to anon, authenticated;
grant select on public.profiles, public.accounts, public.trades, public.quote_ticks,
               public.payout_methods, public.transactions, public.user_tasks, public.notifications to authenticated;
grant update (full_name, phone, active_account_id) on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy settings_read on public.platform_settings for select using (true);
create policy assets_read   on public.assets   for select using (is_active);
create policy tasks_read    on public.tasks    for select using (is_active);
create policy promos_read   on public.promo_codes for select
  using (is_active and starts_at <= now() and (ends_at is null or ends_at > now()));

create policy profiles_own_read on public.profiles for select using (id = auth.uid());
create policy profiles_own_update on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and (active_account_id is null
         or exists (select 1 from public.accounts a where a.id = active_account_id and a.user_id = auth.uid()))
  );

create policy accounts_own_read       on public.accounts       for select using (user_id = auth.uid());
create policy trades_own_read         on public.trades         for select using (user_id = auth.uid());
create policy payout_methods_own_read on public.payout_methods for select using (user_id = auth.uid());
create policy transactions_own_read   on public.transactions   for select using (user_id = auth.uid());
create policy user_tasks_own_read     on public.user_tasks     for select using (user_id = auth.uid());
create policy notifications_own_read  on public.notifications  for select using (user_id = auth.uid());
create policy notifications_own_mark  on public.notifications  for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy quote_ticks_own_read on public.quote_ticks for select
  using (exists (select 1 from public.trades t where t.id = trade_id and t.user_id = auth.uid()));

grant all on all tables in schema public to service_role;

-- ───────────────────────── Signup ─────────────────────────
-- New auth user → profile, DEMO wallet funded with the start balance, NGN and USDT wallets, tasks.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_start numeric(20,2);
  v_demo  uuid;
begin
  select demo_start_balance into v_start from platform_settings where id;
  v_start := coalesce(v_start, 10000);

  insert into profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'phone');

  insert into accounts (user_id, type, currency, balance) values (new.id, 'DEMO', 'ALPHA', v_start)
  returning id into v_demo;
  insert into accounts (user_id, type, currency) values (new.id, 'NGN', 'NGN'), (new.id, 'USDT', 'USDT');

  update profiles set active_account_id = v_demo where id = new.id;

  insert into transactions (user_id, account_id, type, amount, balance_after, completed_at, metadata)
  values (new.id, v_demo, 'demo_reset', v_start, v_start, now(), '{"reason":"signup"}');

  insert into user_tasks (user_id, task_id)
  select new.id, t.id from tasks t where t.is_active;

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── Money functions (service_role only) ─────────────────────────

-- Opens a trade at the server's quote. Payout % and InZone corridor come from the asset row.
create or replace function public.open_trade(
  p_user_id      uuid,
  p_account_id   uuid,
  p_asset_id     text,
  p_mode         public.trade_mode,
  p_direction    public.trade_direction,
  p_amount       numeric,
  p_open_quote   numeric,
  p_duration_sec int     default null,
  p_leverage     int     default null,
  p_take_profit  numeric default null,
  p_stop_loss    numeric default null
) returns public.trades
language plpgsql security definer set search_path = public as $$
declare
  v_acc   accounts;
  v_asset assets;
  v_live  boolean;
  v_trade trades;
begin
  select * into v_acc from accounts where id = p_account_id and user_id = p_user_id for update;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;

  if v_acc.type <> 'DEMO' then
    select live_trading_enabled into v_live from platform_settings where id;
    if not coalesce(v_live, false) then raise exception 'LIVE_TRADING_DISABLED'; end if;
  end if;

  select * into v_asset from assets where id = p_asset_id and is_active;
  if not found then raise exception 'ASSET_UNAVAILABLE'; end if;

  if p_amount is null or p_amount < 1 or p_amount <> round(p_amount, 2) then raise exception 'INVALID_AMOUNT'; end if;
  if p_open_quote is null or p_open_quote <= 0 then raise exception 'INVALID_QUOTE'; end if;

  if p_mode in ('fixed_time', 'inzone') then
    if p_duration_sec is null or p_duration_sec not between 5 and 14400 then raise exception 'INVALID_DURATION'; end if;
  end if;
  if p_mode = 'fixed_time' and p_direction is null then raise exception 'DIRECTION_REQUIRED'; end if;
  if p_mode = 'forex' then
    if p_direction is null then raise exception 'DIRECTION_REQUIRED'; end if;
    if p_leverage is null or p_leverage < 1 or p_leverage > v_asset.max_leverage then raise exception 'INVALID_LEVERAGE'; end if;
  end if;

  if v_acc.balance < p_amount then raise exception 'INSUFFICIENT_FUNDS'; end if;

  update accounts set balance = balance - p_amount where id = v_acc.id;

  insert into trades (user_id, account_id, asset_id, mode, direction, amount, payout_pct, zone_pct,
                      leverage, take_profit, stop_loss, duration_sec, open_quote, expires_at)
  values (
    p_user_id, v_acc.id, p_asset_id, p_mode,
    case when p_mode = 'inzone' then null else p_direction end,
    p_amount,
    case p_mode when 'fixed_time' then v_asset.payout_fixed when 'inzone' then v_asset.payout_inzone end,
    -- Corridor = 0.6 x the expected move over the trade (tick volatility x sqrt(ticks), 4 ticks/sec),
    -- so every duration has the same ~45% win chance (P(|Z| <= 0.6)) instead of short trades nearly always winning.
    case when p_mode = 'inzone' then round(v_asset.volatility * 0.6 * sqrt(p_duration_sec * 4::numeric) * 100, 6) end,
    case when p_mode = 'forex' then p_leverage end,
    case when p_mode = 'forex' then p_take_profit end,
    case when p_mode = 'forex' then p_stop_loss end,
    case when p_mode = 'forex' then null else p_duration_sec end,
    p_open_quote,
    case when p_mode = 'forex' then null else now() + make_interval(secs => p_duration_sec) end
  ) returning * into v_trade;

  insert into transactions (user_id, account_id, type, amount, balance_after, trade_id, completed_at)
  values (p_user_id, v_acc.id, 'stake', -p_amount, v_acc.balance - p_amount, v_trade.id, now());

  return v_trade;
end $$;

-- Settles a trade at the server's closing quote. Idempotent: a closed trade is returned unchanged.
create or replace function public.settle_trade(
  p_trade_id    uuid,
  p_close_quote numeric,
  p_close_time  timestamptz default now()
) returns public.trades
language plpgsql security definer set search_path = public as $$
declare
  v_trade  trades;
  v_return numeric(20,2);
  v_result trade_result;
  v_dir    int;
  v_bal    numeric(20,2);
begin
  select * into v_trade from trades where id = p_trade_id for update;
  if not found then raise exception 'TRADE_NOT_FOUND'; end if;
  if v_trade.status = 'closed' then return v_trade; end if;
  if p_close_quote is null or p_close_quote <= 0 then raise exception 'INVALID_QUOTE'; end if;

  v_dir := case v_trade.direction when 'up' then 1 when 'down' then -1 end;

  if v_trade.mode = 'fixed_time' then
    if p_close_quote = v_trade.open_quote then
      v_result := 'refund'; v_return := v_trade.amount;
    elsif sign(p_close_quote - v_trade.open_quote) = v_dir then
      v_result := 'win';    v_return := round(v_trade.amount * (1 + v_trade.payout_pct / 100), 2);
    else
      v_result := 'loss';   v_return := 0;
    end if;

  elsif v_trade.mode = 'inzone' then
    if abs(p_close_quote - v_trade.open_quote) / v_trade.open_quote * 100 <= v_trade.zone_pct then
      v_result := 'win';  v_return := round(v_trade.amount * (1 + v_trade.payout_pct / 100), 2);
    else
      v_result := 'loss'; v_return := 0;
    end if;

  else -- forex: P&L scales with leverage; the stake is the most that can be lost (stop-out).
    v_return := greatest(0, round(
      v_trade.amount + v_trade.amount * v_trade.leverage * (p_close_quote - v_trade.open_quote) / v_trade.open_quote * v_dir, 2));
    v_result := case when v_return > v_trade.amount then 'win'
                     when v_return = v_trade.amount then 'refund'
                     else 'loss' end;
  end if;

  update trades set status = 'closed', close_quote = p_close_quote, close_time = p_close_time,
                    result = v_result, return_amount = v_return, pnl = v_return - v_trade.amount
  where id = v_trade.id returning * into v_trade;

  if v_return > 0 then
    update accounts set balance = balance + v_return where id = v_trade.account_id returning balance into v_bal;
    insert into transactions (user_id, account_id, type, amount, balance_after, trade_id, completed_at)
    values (v_trade.user_id, v_trade.account_id,
            case when v_result = 'refund' then 'refund'::tx_type else 'payout'::tx_type end,
            v_return, v_bal, v_trade.id, now());
  end if;

  return v_trade;
end $$;

-- Credits a pending deposit once per reference (safe against webhook retries).
create or replace function public.credit_deposit(p_reference text, p_amount numeric)
returns public.transactions
language plpgsql security definer set search_path = public as $$
declare
  v_tx  transactions;
  v_bal numeric(20,2);
begin
  select * into v_tx from transactions where reference = p_reference and type = 'deposit' for update;
  if not found then raise exception 'DEPOSIT_NOT_FOUND'; end if;
  if v_tx.status = 'completed' then return v_tx; end if;
  if v_tx.status <> 'pending' then raise exception 'DEPOSIT_NOT_PENDING'; end if;
  if p_amount is distinct from v_tx.amount then raise exception 'AMOUNT_MISMATCH'; end if;

  update accounts set balance = balance + v_tx.amount where id = v_tx.account_id returning balance into v_bal;
  update transactions set status = 'completed', balance_after = v_bal, completed_at = now()
  where id = v_tx.id returning * into v_tx;
  return v_tx;
end $$;

-- Credits a bonus or task reward once per reference. With p_promo_code, also consumes one use of that code.
create or replace function public.credit_bonus(
  p_account_id uuid,
  p_amount     numeric,
  p_type       public.tx_type,
  p_reference  text,
  p_promo_code text default null
) returns public.transactions
language plpgsql security definer set search_path = public as $$
declare
  v_acc   accounts;
  v_tx    transactions;
  v_promo promo_codes;
begin
  if p_type not in ('bonus', 'task_reward') then raise exception 'INVALID_BONUS_TYPE'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_reference is null then raise exception 'REFERENCE_REQUIRED'; end if;

  select * into v_tx from transactions where reference = p_reference;
  if found then return v_tx; end if;

  select * into v_acc from accounts where id = p_account_id for update;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;

  if p_promo_code is not null then
    select * into v_promo from promo_codes where code = p_promo_code for update;
    if not found or not v_promo.is_active or v_promo.starts_at > now()
       or (v_promo.ends_at is not null and v_promo.ends_at <= now())
       or (v_promo.max_uses is not null and v_promo.uses >= v_promo.max_uses) then
      raise exception 'PROMO_UNAVAILABLE';
    end if;
    update promo_codes set uses = uses + 1 where code = p_promo_code;
  end if;

  update accounts set balance = balance + p_amount where id = v_acc.id;
  insert into transactions (user_id, account_id, type, amount, balance_after, reference, completed_at, metadata)
  values (v_acc.user_id, v_acc.id, p_type, p_amount, v_acc.balance + p_amount, p_reference, now(),
          jsonb_strip_nulls(jsonb_build_object('promo_code', p_promo_code)))
  returning * into v_tx;
  return v_tx;
end $$;

-- Moves funds from balance to locked and records a pending withdrawal.
create or replace function public.request_withdrawal(
  p_user_id          uuid,
  p_account_id       uuid,
  p_amount           numeric,
  p_payout_method_id uuid
) returns public.transactions
language plpgsql security definer set search_path = public as $$
declare
  v_acc  accounts;
  v_set  platform_settings;
  v_kyc  kyc_status;
  v_tx   transactions;
begin
  select * into v_set from platform_settings where id;
  if not coalesce(v_set.live_trading_enabled, false) then raise exception 'LIVE_TRADING_DISABLED'; end if;

  select kyc_status into v_kyc from profiles where id = p_user_id;
  if v_kyc is distinct from 'verified' then raise exception 'KYC_REQUIRED'; end if;

  if not exists (select 1 from payout_methods where id = p_payout_method_id and user_id = p_user_id) then
    raise exception 'PAYOUT_METHOD_NOT_FOUND';
  end if;

  select * into v_acc from accounts where id = p_account_id and user_id = p_user_id for update;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if v_acc.type = 'DEMO' then raise exception 'DEMO_NOT_WITHDRAWABLE'; end if;

  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then raise exception 'INVALID_AMOUNT'; end if;
  if v_acc.type = 'NGN' and p_amount < v_set.min_withdrawal_ngn then raise exception 'BELOW_MIN_WITHDRAWAL'; end if;
  if v_acc.balance < p_amount then raise exception 'INSUFFICIENT_FUNDS'; end if;

  update accounts set balance = balance - p_amount, locked = locked + p_amount where id = v_acc.id;
  insert into transactions (user_id, account_id, type, status, amount, balance_after, payout_method_id)
  values (p_user_id, v_acc.id, 'withdrawal', 'pending', -p_amount, v_acc.balance - p_amount, p_payout_method_id)
  returning * into v_tx;
  return v_tx;
end $$;

-- Admin decision on a pending withdrawal: approve releases the locked funds, reject returns them to the balance.
create or replace function public.resolve_withdrawal(
  p_transaction_id uuid,
  p_approve        boolean,
  p_admin_id       uuid,
  p_note           text default null
) returns public.transactions
language plpgsql security definer set search_path = public as $$
declare
  v_tx  transactions;
  v_amt numeric(20,2);
  v_bal numeric(20,2);
begin
  if not exists (select 1 from profiles where id = p_admin_id and is_admin) then raise exception 'NOT_ADMIN'; end if;

  select * into v_tx from transactions where id = p_transaction_id and type = 'withdrawal' for update;
  if not found then raise exception 'WITHDRAWAL_NOT_FOUND'; end if;
  if v_tx.status <> 'pending' then raise exception 'ALREADY_RESOLVED'; end if;

  v_amt := -v_tx.amount;
  if p_approve then
    update accounts set locked = locked - v_amt where id = v_tx.account_id returning balance into v_bal;
  else
    update accounts set locked = locked - v_amt, balance = balance + v_amt where id = v_tx.account_id returning balance into v_bal;
  end if;

  update transactions
  set status = case when p_approve then 'completed'::tx_status else 'rejected'::tx_status end,
      balance_after = v_bal, completed_at = now(),
      metadata = metadata || jsonb_strip_nulls(jsonb_build_object('resolved_by', p_admin_id, 'note', p_note))
  where id = v_tx.id returning * into v_tx;
  return v_tx;
end $$;

-- Restores the DEMO wallet to the start balance. Refused while demo trades are open.
create or replace function public.reset_demo(p_user_id uuid)
returns public.accounts
language plpgsql security definer set search_path = public as $$
declare
  v_acc   accounts;
  v_start numeric(20,2);
begin
  select * into v_acc from accounts where user_id = p_user_id and type = 'DEMO' for update;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if exists (select 1 from trades where account_id = v_acc.id and status = 'open') then
    raise exception 'OPEN_TRADES_EXIST';
  end if;

  select demo_start_balance into v_start from platform_settings where id;
  v_start := coalesce(v_start, 10000);

  insert into transactions (user_id, account_id, type, amount, balance_after, completed_at, metadata)
  values (p_user_id, v_acc.id, 'demo_reset', v_start - v_acc.balance, v_start, now(), '{"reason":"reset"}');
  update accounts set balance = v_start where id = v_acc.id returning * into v_acc;
  return v_acc;
end $$;

revoke execute on function
  public.open_trade(uuid, uuid, text, public.trade_mode, public.trade_direction, numeric, numeric, int, int, numeric, numeric),
  public.settle_trade(uuid, numeric, timestamptz),
  public.credit_deposit(text, numeric),
  public.credit_bonus(uuid, numeric, public.tx_type, text, text),
  public.request_withdrawal(uuid, uuid, numeric, uuid),
  public.resolve_withdrawal(uuid, boolean, uuid, text),
  public.reset_demo(uuid),
  public.handle_new_user()
from public, anon, authenticated;

grant execute on function
  public.open_trade(uuid, uuid, text, public.trade_mode, public.trade_direction, numeric, numeric, int, int, numeric, numeric),
  public.settle_trade(uuid, numeric, timestamptz),
  public.credit_deposit(text, numeric),
  public.credit_bonus(uuid, numeric, public.tx_type, text, text),
  public.request_withdrawal(uuid, uuid, numeric, uuid),
  public.resolve_withdrawal(uuid, boolean, uuid, text),
  public.reset_demo(uuid)
to service_role;

-- ───────────────────────── Realtime ─────────────────────────
alter publication supabase_realtime add table public.accounts, public.trades, public.notifications;
