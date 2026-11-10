-- Withdrawal fee (owner decision 2026-11-10: 15% of each withdrawal is the app's revenue) and safe bank-transfer outcomes.
-- * The fee rate is a platform setting (0-50%). The rate is fixed on the withdrawal when the user asks, so the user is paid
--   exactly what was shown, even if the rate changes before approval.
-- * The user's balance goes down by the amount asked; the bank receives that amount minus the fee.
-- * The fee becomes revenue only when the withdrawal is approved. A rejected withdrawal returns everything, fee included.
-- * A bank transfer that fails or is reversed after approval returns the whole amount and cancels the fee revenue.

alter table public.platform_settings
  add column if not exists withdrawal_fee_pct numeric(5,2) not null default 15 check (withdrawal_fee_pct >= 0 and withdrawal_fee_pct <= 50);

-- The app's income, one row per source transaction. Backend only.
create table if not exists public.platform_revenue (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions (id),
  kind           text not null check (kind in ('withdrawal_fee')),
  currency       public.account_type not null,
  amount         numeric(20,2) not null check (amount > 0),
  created_at     timestamptz not null default now(),
  reversed_at    timestamptz
);
alter table public.platform_revenue enable row level security;
revoke all on public.platform_revenue from anon, authenticated;

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
  v_fee  numeric(20,2);
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

  v_fee := round(p_amount * v_set.withdrawal_fee_pct / 100, 2);
  if p_amount - v_fee <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  update accounts set balance = balance - p_amount, locked = locked + p_amount where id = v_acc.id;
  insert into transactions (user_id, account_id, type, status, amount, balance_after, payout_method_id, metadata)
  values (p_user_id, v_acc.id, 'withdrawal', 'pending', -p_amount, v_acc.balance - p_amount, p_payout_method_id,
          jsonb_build_object('fee', v_fee, 'fee_pct', v_set.withdrawal_fee_pct, 'payout', p_amount - v_fee))
  returning * into v_tx;
  return v_tx;
end $$;

-- Admin decision on a pending withdrawal: approve releases the locked funds and books the fee, reject returns everything.
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
  v_cur account_type;
  v_fee numeric(20,2);
begin
  if not exists (select 1 from profiles where id = p_admin_id and is_admin) then raise exception 'NOT_ADMIN'; end if;

  select * into v_tx from transactions where id = p_transaction_id and type = 'withdrawal' for update;
  if not found then raise exception 'WITHDRAWAL_NOT_FOUND'; end if;
  if v_tx.status <> 'pending' then raise exception 'ALREADY_RESOLVED'; end if;

  v_amt := -v_tx.amount;
  if p_approve then
    update accounts set locked = locked - v_amt where id = v_tx.account_id returning balance, type into v_bal, v_cur;
    v_fee := coalesce((v_tx.metadata ->> 'fee')::numeric, 0);
    if v_fee > 0 then
      insert into platform_revenue (transaction_id, kind, currency, amount) values (v_tx.id, 'withdrawal_fee', v_cur, v_fee);
    end if;
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

-- The bank transfer of an approved withdrawal failed or was reversed (Paystack transfer.failed / transfer.reversed):
-- the whole amount goes back to the user, the fee revenue is cancelled. Safe to call more than once.
create or replace function public.reverse_withdrawal(
  p_transaction_id uuid,
  p_reason         text
) returns public.transactions
language plpgsql security definer set search_path = public as $$
declare
  v_tx  transactions;
  v_amt numeric(20,2);
  v_bal numeric(20,2);
begin
  select * into v_tx from transactions where id = p_transaction_id and type = 'withdrawal' for update;
  if not found then raise exception 'WITHDRAWAL_NOT_FOUND'; end if;
  if v_tx.status <> 'completed' then return v_tx; end if;   -- pending, rejected or already reversed: nothing to undo

  v_amt := -v_tx.amount;
  update accounts set balance = balance + v_amt where id = v_tx.account_id returning balance into v_bal;
  update platform_revenue set reversed_at = now() where transaction_id = v_tx.id and reversed_at is null;
  update transactions
  set status = 'failed', balance_after = v_bal,
      metadata = metadata || jsonb_build_object('transfer_failed', p_reason, 'returned_at', now())
  where id = v_tx.id returning * into v_tx;
  return v_tx;
end $$;

revoke execute on function public.request_withdrawal(uuid, uuid, numeric, uuid), public.resolve_withdrawal(uuid, boolean, uuid, text),
  public.reverse_withdrawal(uuid, text) from public, anon, authenticated;
grant execute on function public.request_withdrawal(uuid, uuid, numeric, uuid), public.resolve_withdrawal(uuid, boolean, uuid, text),
  public.reverse_withdrawal(uuid, text) to service_role;
