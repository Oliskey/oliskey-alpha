-- 010: Profitability Boosts and the Referral Program (owner decisions 2026-11-04).
--  * Boost: +10 percentage points on Fixed Time payouts for 1 hour, DEMO account only until live trading is licensed.
--    Earned by finishing a task or when an invited friend finishes a first trade. The server applies it at open.
--  * Referral: the inviter earns a USD 100 bonus on the USDT account: it can be traded but not withdrawn, while profits
--    can. REAL-MONEY GATE: nothing is credited unless platform_settings.live_trading_enabled is true, and only after the
--    invited friend is identity-verified and has a completed real deposit, so fake sign-ups earn nothing.

alter table public.profiles add column if not exists referral_code text not null default upper(substr(md5(gen_random_uuid()::text), 1, 8));
alter table public.profiles add column if not exists referred_by uuid references public.profiles (id) on delete set null;
create unique index if not exists profiles_referral_code_idx on public.profiles (referral_code);

alter table public.accounts add column if not exists bonus_locked numeric(20,2) not null default 0 check (bonus_locked >= 0);
alter table public.trades add column if not exists boosted boolean not null default false;

create table if not exists public.user_boosts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  source_ref   text not null,                     -- e.g. task:first_trade:<accepted time>, invite:<friend id>
  status       text not null default 'available' check (status in ('available', 'active')),
  activated_at timestamptz,
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (user_id, source_ref)
);
create index if not exists user_boosts_user_idx on public.user_boosts (user_id, status);
alter table public.user_boosts enable row level security;
grant select on public.user_boosts to authenticated;
drop policy if exists user_boosts_own_read on public.user_boosts;
create policy user_boosts_own_read on public.user_boosts for select using (user_id = auth.uid());

create table if not exists public.referral_rewards (
  id          uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles (id) on delete cascade,
  invitee_id  uuid not null unique references public.profiles (id) on delete cascade,   -- one reward per invited person
  amount      numeric(20,2) not null default 100,
  status      text not null default 'waiting' check (status in ('waiting', 'released')),
  created_at  timestamptz not null default now(),
  released_at timestamptz
);
create index if not exists referral_rewards_referrer_idx on public.referral_rewards (referrer_id);
alter table public.referral_rewards enable row level security;
grant select on public.referral_rewards to authenticated;
drop policy if exists referral_rewards_own_read on public.referral_rewards;
create policy referral_rewards_own_read on public.referral_rewards for select using (referrer_id = auth.uid());

-- Link a new account to whoever invited it. Unknown codes and your own code are ignored.
create or replace function public.set_referrer(p_invitee uuid, p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_referrer uuid;
begin
  select id into v_referrer from profiles where referral_code = upper(trim(p_code)) and deleted_at is null;
  if v_referrer is null or v_referrer = p_invitee then return false; end if;
  update profiles set referred_by = v_referrer where id = p_invitee and referred_by is null;
  if not found then return false; end if;
  insert into referral_rewards (referrer_id, invitee_id) values (v_referrer, p_invitee) on conflict (invitee_id) do nothing;
  return true;
end $$;

-- Grant one boost; the same reason never grants twice.
create or replace function public.grant_boost(p_user uuid, p_ref text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into user_boosts (user_id, source_ref) values (p_user, p_ref) on conflict (user_id, source_ref) do nothing;
  return found;
end $$;

-- Start the oldest waiting boost: 1 hour, one at a time.
create or replace function public.activate_boost(p_user uuid) returns public.user_boosts
language plpgsql security definer set search_path = public as $$
declare v_boost user_boosts;
begin
  perform pg_advisory_xact_lock(hashtext('boost:' || p_user::text));
  if exists (select 1 from user_boosts where user_id = p_user and status = 'active' and expires_at > now()) then
    raise exception 'BOOST_ALREADY_ACTIVE';
  end if;
  select * into v_boost from user_boosts where user_id = p_user and status = 'available' order by created_at limit 1 for update;
  if not found then raise exception 'NO_BOOST_AVAILABLE'; end if;
  update user_boosts set status = 'active', activated_at = now(), expires_at = now() + interval '1 hour'
  where id = v_boost.id returning * into v_boost;
  return v_boost;
end $$;

-- Called while a trade opens, in the same transaction: an active boost raises this trade's payout. Demo Fixed Time only.
create or replace function public.apply_boost(p_trade uuid, p_user uuid) returns public.trades
language plpgsql security definer set search_path = public as $$
declare v_trade trades; v_type account_type;
begin
  select * into v_trade from trades where id = p_trade and user_id = p_user for update;
  if not found then raise exception 'TRADE_NOT_FOUND'; end if;
  select type into v_type from accounts where id = v_trade.account_id;
  if v_trade.mode = 'fixed_time' and v_type = 'DEMO' and v_trade.status = 'open' and not v_trade.boosted
     and exists (select 1 from user_boosts where user_id = p_user and status = 'active' and expires_at > now()) then
    update trades set payout_pct = payout_pct + 10, boosted = true where id = p_trade returning * into v_trade;
  end if;
  return v_trade;
end $$;

-- After a person's first finished trade: their inviter earns one boost. Returns the inviter when newly earned.
create or replace function public.referral_on_trade(p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_referrer uuid;
begin
  select referred_by into v_referrer from profiles where id = p_user;
  if v_referrer is null then return null; end if;
  if grant_boost(v_referrer, 'invite:' || p_user::text) then return v_referrer; end if;
  return null;
end $$;

-- REAL-MONEY GATE. Pays waiting bonuses only while live trading is on, and only for friends who are verified and have
-- really deposited. The bonus goes through credit_bonus and is marked as not withdrawable. Safe to call repeatedly.
create or replace function public.release_referral_bonuses() returns int
language plpgsql security definer set search_path = public as $$
declare r referral_rewards; v_acc uuid; v_done int := 0;
begin
  if not coalesce((select live_trading_enabled from platform_settings where id), false) then return 0; end if;
  for r in
    select rr.* from referral_rewards rr join profiles p on p.id = rr.invitee_id
    where rr.status = 'waiting' and p.kyc_status = 'verified'
      and exists (select 1 from transactions t where t.user_id = rr.invitee_id and t.type = 'deposit' and t.status = 'completed')
    for update of rr
  loop
    select id into v_acc from accounts where user_id = r.referrer_id and type = 'USDT';
    if v_acc is null then continue; end if;
    perform credit_bonus(v_acc, r.amount, 'bonus', 'referral:' || r.invitee_id::text, null);
    update accounts set bonus_locked = bonus_locked + r.amount where id = v_acc;
    update referral_rewards set status = 'released', released_at = now() where id = r.id;
    v_done := v_done + 1;
  end loop;
  return v_done;
end $$;

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
  -- a referral bonus can be traded but not withdrawn; profits made with it can
  if v_acc.balance - least(v_acc.bonus_locked, v_acc.balance) < p_amount then raise exception 'BONUS_NOT_WITHDRAWABLE'; end if;

  update accounts set balance = balance - p_amount, locked = locked + p_amount where id = v_acc.id;
  insert into transactions (user_id, account_id, type, status, amount, balance_after, payout_method_id)
  values (p_user_id, v_acc.id, 'withdrawal', 'pending', -p_amount, v_acc.balance - p_amount, p_payout_method_id)
  returning * into v_tx;
  return v_tx;
end $$;

revoke execute on function public.set_referrer(uuid, text), public.grant_boost(uuid, text), public.activate_boost(uuid),
  public.apply_boost(uuid, uuid), public.referral_on_trade(uuid), public.release_referral_bonuses(),
  public.request_withdrawal(uuid, uuid, numeric, uuid) from public, anon, authenticated;
grant execute on function public.set_referrer(uuid, text), public.grant_boost(uuid, text), public.activate_boost(uuid),
  public.apply_boost(uuid, uuid), public.referral_on_trade(uuid), public.release_referral_bonuses(),
  public.request_withdrawal(uuid, uuid, numeric, uuid) to service_role;
