-- Risk-free trades and pending-order rows. Runs in one transaction and rolls back.
begin;

create temp table t_ids (k text primary key, v uuid);
grant select on t_ids to authenticated;
insert into auth.users (email) values ('rf-a@test.local'), ('rf-b@test.local');
insert into t_ids select 'a', id from auth.users where email = 'rf-a@test.local';
insert into t_ids select 'b', id from auth.users where email = 'rf-b@test.local';
insert into t_ids select 'a_demo', a.id from accounts a join t_ids t on t.k = 'a' and a.user_id = t.v where a.type = 'DEMO';

do $$
declare
  u   uuid := (select v from t_ids where k = 'a');
  b   uuid := (select v from t_ids where k = 'b');
  acc uuid := (select v from t_ids where k = 'a_demo');
  t   trades;
  msg text;
begin
  -- a lost risk-free trade returns the stake as a refund
  t := open_trade(u, acc, 'EURUSD', 'fixed_time', 'up', 100, 1.11620, 60);
  t := make_trade_risk_free(t.id, u);
  assert t.risk_free, 'flag set';
  t := settle_trade(t.id, 1.11600);
  assert t.result = 'refund' and t.return_amount = 100 and t.pnl = 0, 'lost risk-free trade refunded: ' || t.result;
  assert (select balance from accounts where id = acc) = 10000, 'balance back to start';

  -- a won risk-free trade pays normally
  t := open_trade(u, acc, 'EURUSD', 'fixed_time', 'up', 100, 1.11620, 60);
  perform make_trade_risk_free(t.id, u);
  t := settle_trade(t.id, 1.11640);
  assert t.result = 'win' and t.return_amount = 185, 'risk-free win pays the normal payout';

  -- third today is fine, fourth is refused
  t := open_trade(u, acc, 'EURUSD', 'fixed_time', 'up', 10, 1.11620, 60);
  perform make_trade_risk_free(t.id, u);
  t := open_trade(u, acc, 'EURUSD', 'fixed_time', 'up', 10, 1.11620, 60);
  begin perform make_trade_risk_free(t.id, u); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'RISK_FREE_LIMIT', '4th risk-free trade today refused: ' || msg;

  -- forex cannot be risk-free; another user cannot flag it
  t := open_trade(u, acc, 'EURUSD', 'forex', 'up', 10, 1.11620, null, 10);
  begin perform make_trade_risk_free(t.id, u); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'RISK_FREE_NOT_ALLOWED', 'forex refused: ' || msg;
  t := open_trade(u, acc, 'EURUSD', 'fixed_time', 'up', 10, 1.11620, 60);
  begin perform make_trade_risk_free(t.id, b); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'TRADE_NOT_FOUND', 'other user refused: ' || msg;

  -- ordinary (not risk-free) losses still lose
  t := settle_trade(t.id, 1.11600);
  assert t.result = 'loss' and t.return_amount = 0, 'normal loss unchanged';

  -- ledger still equals balance
  assert not exists (
    select 1 from accounts a where a.id = acc and a.balance + a.locked <>
      (select coalesce(sum(amount), 0) from transactions x where x.account_id = a.id and x.status = 'completed')
  ), 'ledger matches balance';

  insert into pending_orders (user_id, account_id, asset_id, mode, direction, amount, duration_sec, trigger_price, trigger_when, expires_at)
  values (u, acc, 'EURUSD', 'fixed_time', 'up', 10, 60, 1.2, 'above', now() + interval '1 day');
end $$;

-- users read only their own orders and can't write them
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', (select v::text from t_ids where k = 'b'), true); end $$;
do $$
declare msg text;
begin
  assert (select count(*) from pending_orders) = 0, 'B cannot see A''s orders';
  begin insert into pending_orders (user_id, account_id, asset_id, mode, amount, trigger_price, trigger_when, expires_at)
        values (auth.uid(), gen_random_uuid(), 'EURUSD', 'fixed_time', 10, 1, 'above', now()); msg := 'none';
  exception when others then msg := sqlerrm; end;
  assert msg like 'permission denied%', 'users cannot write orders: ' || msg;
  begin perform make_trade_risk_free(gen_random_uuid(), auth.uid()); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg like 'permission denied%', 'users cannot call make_trade_risk_free: ' || msg;
end $$;
reset role;

rollback;
