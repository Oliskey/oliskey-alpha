-- Owner decisions 2026-10-30:
--  * Risk-free trades: a lost risk-free Fixed Time / InZone trade returns the stake. Limited to 3 per day per demo account
--    (real-money accounts get none until promotions define them). The limit is enforced here, under the account lock.
--  * Pending orders: the user sets a trigger price; the backend opens the trade (through open_trade, at the server's
--    price) when the market reaches it. No money is reserved until it fills.
--  * Funded programme: interest sign-ups only (the programme itself waits for licensing).

-- ── Risk-free ──
alter table public.trades add column if not exists risk_free boolean not null default false;

create or replace function public.make_trade_risk_free(p_trade_id uuid, p_user_id uuid)
returns public.trades
language plpgsql security definer set search_path = public as $$
declare
  v_trade trades;
  v_acc   accounts;
  v_used  int;
begin
  select * into v_trade from trades where id = p_trade_id and user_id = p_user_id for update;
  if not found then raise exception 'TRADE_NOT_FOUND'; end if;
  if v_trade.status <> 'open' then raise exception 'TRADE_ALREADY_CLOSED'; end if;
  if v_trade.mode not in ('fixed_time', 'inzone') then raise exception 'RISK_FREE_NOT_ALLOWED'; end if;
  if v_trade.risk_free then return v_trade; end if;

  -- the account lock serialises concurrent requests, so the daily count can't be exceeded by a race
  select * into v_acc from accounts where id = v_trade.account_id for update;
  if v_acc.type <> 'DEMO' then raise exception 'RISK_FREE_NOT_ALLOWED'; end if;
  select count(*) into v_used from trades
   where account_id = v_acc.id and risk_free and open_time >= date_trunc('day', now());
  if v_used >= 3 then raise exception 'RISK_FREE_LIMIT'; end if;

  update trades set risk_free = true where id = v_trade.id returning * into v_trade;
  return v_trade;
end $$;

-- Same as 001's settle_trade, plus: a lost risk-free trade becomes a refund of the stake.
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

  if v_trade.risk_free and v_result = 'loss' then
    v_result := 'refund'; v_return := v_trade.amount;
  end if;

  update trades set status = 'closed', close_quote = p_close_quote, close_time = p_close_time,
                    result = v_result, return_amount = v_return, pnl = v_return - v_trade.amount
  where id = v_trade.id returning * into v_trade;

  if v_return > 0 then
    update accounts set balance = balance + v_return where id = v_trade.account_id returning balance into v_bal;
    insert into transactions (user_id, account_id, type, amount, balance_after, trade_id, completed_at, metadata)
    values (v_trade.user_id, v_trade.account_id,
            case when v_result = 'refund' then 'refund'::tx_type else 'payout'::tx_type end,
            v_return, v_bal, v_trade.id, now(),
            case when v_trade.risk_free and v_result = 'refund' then '{"risk_free":true}'::jsonb else '{}'::jsonb end);
  end if;

  return v_trade;
end $$;

revoke execute on function public.make_trade_risk_free(uuid, uuid) from public, anon, authenticated;
grant execute on function public.make_trade_risk_free(uuid, uuid) to service_role;
revoke execute on function public.settle_trade(uuid, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.settle_trade(uuid, numeric, timestamptz) to service_role;

-- ── Pending orders ──
create table if not exists public.pending_orders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  account_id    uuid not null references public.accounts (id) on delete cascade,
  asset_id      text not null references public.assets (id),
  mode          public.trade_mode not null,
  direction     public.trade_direction,
  amount        numeric(20,2) not null check (amount >= 1),
  duration_sec  int,
  leverage      int,
  risk_free     boolean not null default false,
  trigger_price numeric not null check (trigger_price > 0),
  trigger_when  text not null check (trigger_when in ('above', 'below')),   -- fill when price >= / <= trigger
  status        text not null default 'pending' check (status in ('pending', 'filled', 'cancelled', 'expired', 'failed')),
  fail_reason   text,
  trade_id      uuid references public.trades (id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  resolved_at   timestamptz
);
create index if not exists pending_orders_open_idx on public.pending_orders (status) where status = 'pending';
create index if not exists pending_orders_user_idx on public.pending_orders (user_id, created_at desc);
alter table public.pending_orders enable row level security;
grant select on public.pending_orders to authenticated;
drop policy if exists pending_orders_own_read on public.pending_orders;
create policy pending_orders_own_read on public.pending_orders for select using (user_id = auth.uid());

-- ── Funded programme interest ──
create table if not exists public.funded_interest (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.funded_interest enable row level security;
grant select on public.funded_interest to authenticated;
drop policy if exists funded_interest_own_read on public.funded_interest;
create policy funded_interest_own_read on public.funded_interest for select using (user_id = auth.uid());
