-- Close Early rules. Runs in one transaction and rolls back. now() is fixed inside a transaction,
-- so each case moves the trade's open/expiry times instead of waiting.
begin;

create temp table t_ids (k text primary key, v uuid);
insert into auth.users (email) values ('ce-a@test.local'), ('ce-b@test.local');
insert into t_ids select 'a', id from auth.users where email = 'ce-a@test.local';
insert into t_ids select 'b', id from auth.users where email = 'ce-b@test.local';
insert into t_ids select 'a_demo', a.id from accounts a join t_ids t on t.k = 'a' and a.user_id = t.v where a.type = 'DEMO';

do $$
declare
  u   uuid := (select v from t_ids where k = 'a');
  b   uuid := (select v from t_ids where k = 'b');
  acc uuid := (select v from t_ids where k = 'a_demo');
  t   trades;
  msg text;
begin
  -- happy path: 10 s into a 60 s trade, return 120 (under the 90% cap of 185 = 166.50)
  t := open_trade(u, acc, 'EURUSD', 'fixed_time', 'up', 100, 1.11620, 60);
  update trades set open_time = now() - interval '10 seconds', expires_at = now() + interval '50 seconds' where id = t.id;
  t := close_trade_early(t.id, u, 1.11625, 120);
  assert t.status = 'closed' and t.closed_early and t.result = 'win' and t.return_amount = 120 and t.pnl = 20, 'early close pays the priced amount';
  assert (select balance from accounts where id = acc) = 10020, 'balance credited once';
  assert (select count(*) from transactions where trade_id = t.id and type = 'payout' and metadata ? 'closed_early') = 1, 'one ledger row';

  -- only once: a second early close, and expiry settlement afterwards, change nothing
  begin perform close_trade_early(t.id, u, 1.11625, 120); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'TRADE_ALREADY_CLOSED', 'cannot close early twice: ' || msg;
  t := settle_trade(t.id, 1.2);
  assert t.return_amount = 120 and (select balance from accounts where id = acc) = 10020, 'expiry after early close pays nothing more';

  -- the reverse race: expiry settled first, early close is refused
  t := open_trade(u, acc, 'EURUSD', 'fixed_time', 'up', 100, 1.11620, 60);
  update trades set open_time = now() - interval '10 seconds', expires_at = now() + interval '50 seconds' where id = t.id;
  perform settle_trade(t.id, 1.11600);   -- loss: balance 9920
  begin perform close_trade_early(t.id, u, 1.11600, 50); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'TRADE_ALREADY_CLOSED', 'early close after expiry refused: ' || msg;
  assert (select balance from accounts where id = acc) = 9920, 'no money after a settled loss';

  -- timing window
  t := open_trade(u, acc, 'EURUSD', 'fixed_time', 'up', 100, 1.11620, 60);   -- opened "now": inside the first 2 s
  begin perform close_trade_early(t.id, u, 1.11620, 10); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'CLOSE_EARLY_TOO_SOON', 'first 2 seconds refused: ' || msg;
  update trades set open_time = now() - interval '58 seconds', expires_at = now() + interval '2 seconds' where id = t.id;
  begin perform close_trade_early(t.id, u, 1.11620, 10); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'CLOSE_EARLY_TOO_LATE', 'last 3 seconds refused: ' || msg;

  -- amount limits: above 90% of the full win, or negative, is refused
  update trades set open_time = now() - interval '10 seconds', expires_at = now() + interval '50 seconds' where id = t.id;
  begin perform close_trade_early(t.id, u, 1.11620, 166.51); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'INVALID_EARLY_RETURN', 'above 90% cap refused: ' || msg;
  begin perform close_trade_early(t.id, u, 1.11620, -1); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'INVALID_EARLY_RETURN', 'negative refused: ' || msg;

  -- another user, and other modes
  begin perform close_trade_early(t.id, b, 1.11620, 10); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'TRADE_NOT_FOUND', 'other user cannot close it: ' || msg;
  t := close_trade_early(t.id, u, 1.11620, 0);
  assert t.result = 'loss' and t.return_amount = 0 and t.pnl = -100, 'zero return is a loss with no ledger payout';

  t := open_trade(u, acc, 'EURUSD', 'inzone', null, 100, 1.11620, 60);
  update trades set open_time = now() - interval '10 seconds', expires_at = now() + interval '50 seconds' where id = t.id;
  begin perform close_trade_early(t.id, u, 1.11620, 10); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'CLOSE_EARLY_NOT_ALLOWED', 'InZone cannot close early: ' || msg;
end $$;

-- users can never call it themselves
set local role authenticated;
do $$
declare msg text;
begin
  begin perform close_trade_early(gen_random_uuid(), gen_random_uuid(), 1, 1); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg like 'permission denied%', 'blocked for users: ' || msg;
end $$;
reset role;

rollback;
