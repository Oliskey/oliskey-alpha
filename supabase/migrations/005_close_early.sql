-- Close Early for Fixed Time trades (owner decision 2026-10-30).
-- The backend prices the early return (win amount x current chance of winning, minus a 10% fee);
-- this function enforces the rules again so a bad caller can never take more:
--   * only open Fixed Time trades of that user, and only once (the row lock makes expiry and early close exclusive)
--   * not in the first 2 seconds after opening or the last 3 seconds before expiry
--   * 0 <= return <= 90% of the full win (stake + payout)

alter table public.trades add column if not exists closed_early boolean not null default false;

create or replace function public.close_trade_early(
  p_trade_id    uuid,
  p_user_id     uuid,
  p_close_quote numeric,
  p_return      numeric
) returns public.trades
language plpgsql security definer set search_path = public as $$
declare
  v_trade  trades;
  v_full   numeric(20,2);
  v_return numeric(20,2);
  v_result trade_result;
  v_bal    numeric(20,2);
begin
  select * into v_trade from trades where id = p_trade_id and user_id = p_user_id for update;
  if not found then raise exception 'TRADE_NOT_FOUND'; end if;
  if v_trade.status = 'closed' then raise exception 'TRADE_ALREADY_CLOSED'; end if;
  if v_trade.mode <> 'fixed_time' then raise exception 'CLOSE_EARLY_NOT_ALLOWED'; end if;
  if now() < v_trade.open_time + interval '2 seconds' then raise exception 'CLOSE_EARLY_TOO_SOON'; end if;
  if now() > v_trade.expires_at - interval '3 seconds' then raise exception 'CLOSE_EARLY_TOO_LATE'; end if;
  if p_close_quote is null or p_close_quote <= 0 then raise exception 'INVALID_QUOTE'; end if;

  v_full := round(v_trade.amount * (1 + v_trade.payout_pct / 100), 2);
  v_return := round(p_return, 2);
  if v_return is null or v_return < 0 or v_return > round(v_full * 0.9, 2) then raise exception 'INVALID_EARLY_RETURN'; end if;

  v_result := case when v_return > v_trade.amount then 'win'
                   when v_return = v_trade.amount then 'refund'
                   else 'loss' end;

  update trades set status = 'closed', close_quote = p_close_quote, close_time = now(), closed_early = true,
                    result = v_result, return_amount = v_return, pnl = v_return - v_trade.amount
  where id = v_trade.id returning * into v_trade;

  if v_return > 0 then
    update accounts set balance = balance + v_return where id = v_trade.account_id returning balance into v_bal;
    insert into transactions (user_id, account_id, type, amount, balance_after, trade_id, completed_at, metadata)
    values (v_trade.user_id, v_trade.account_id, 'payout', v_return, v_bal, v_trade.id, now(), '{"closed_early":true}');
  end if;

  return v_trade;
end $$;

revoke execute on function public.close_trade_early(uuid, uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.close_trade_early(uuid, uuid, numeric, numeric) to service_role;
