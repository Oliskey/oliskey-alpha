-- Money-rule tests. Runs in one transaction and rolls back. Any failed assert aborts with a message.
begin;

create temp table t_ids (k text primary key, v uuid);
grant select on t_ids to authenticated;

-- ── Signup creates profile, wallets, tasks and the opening ledger row ──
insert into auth.users (email, raw_user_meta_data) values ('a@test.local', '{"full_name":"Ada"}');
insert into auth.users (email) values ('b@test.local');
insert into t_ids select 'a', id from auth.users where email = 'a@test.local';
insert into t_ids select 'b', id from auth.users where email = 'b@test.local';
insert into t_ids select 'a_demo', a.id from accounts a join t_ids t on t.k = 'a' and a.user_id = t.v where a.type = 'DEMO';
insert into t_ids select 'a_ngn',  a.id from accounts a join t_ids t on t.k = 'a' and a.user_id = t.v where a.type = 'NGN';
insert into t_ids select 'b_demo', a.id from accounts a join t_ids t on t.k = 'b' and a.user_id = t.v where a.type = 'DEMO';

do $$
declare a uuid := (select v from t_ids where k = 'a');
begin
  assert (select full_name from profiles where id = a) = 'Ada', 'profile name';
  assert (select count(*) from accounts where user_id = a) = 3, 'three wallets';
  assert (select balance from accounts where id = (select v from t_ids where k = 'a_demo')) = 10000, 'demo starts at 10000';
  assert (select active_account_id from profiles where id = a) = (select v from t_ids where k = 'a_demo'), 'demo is active';
  assert (select count(*) from user_tasks where user_id = a) = 4, 'tasks assigned';
end $$;

-- ── Fixed Time: win pays stake x 1.85, loss pays 0, equal close refunds ──
do $$
declare
  u uuid := (select v from t_ids where k = 'a');
  acc uuid := (select v from t_ids where k = 'a_demo');
  t trades;
begin
  t := open_trade(u, acc, 'EURUSD', 'fixed_time', 'up', 100, 1.11620, 5);
  assert (select balance from accounts where id = acc) = 9900, 'stake debited';
  assert t.payout_pct = 85 and t.expires_at > t.open_time, 'payout and expiry set by DB';
  t := settle_trade(t.id, 1.11630);
  assert t.result = 'win' and t.return_amount = 185 and t.pnl = 85, 'up win pays 185';
  assert (select balance from accounts where id = acc) = 10085, 'balance after win';

  -- idempotent: settling again changes nothing
  t := settle_trade(t.id, 1.00000);
  assert t.result = 'win' and (select balance from accounts where id = acc) = 10085, 'settle is idempotent';

  t := settle_trade((open_trade(u, acc, 'EURUSD', 'fixed_time', 'down', 100, 1.11620, 5)).id, 1.11630);
  assert t.result = 'loss' and t.return_amount = 0 and t.pnl = -100, 'down loss';
  t := settle_trade((open_trade(u, acc, 'EURUSD', 'fixed_time', 'up', 100, 1.11620, 5)).id, 1.11620);
  assert t.result = 'refund' and t.return_amount = 100, 'equal close refunds';
  assert (select balance from accounts where id = acc) = 9985, 'balance after loss + refund';
end $$;

-- ── InZone: corridor = vol*0.6*sqrt(sec*4)*100 % (EURUSD 60s = 0.018590%), inside wins 110% ──
do $$
declare
  u uuid := (select v from t_ids where k = 'a');
  acc uuid := (select v from t_ids where k = 'a_demo');
  t trades;
begin
  t := open_trade(u, acc, 'EURUSD', 'inzone', null, 10, 1.00000, 240);
  assert t.zone_pct = 0.037181, 'zone doubles (to rounding) when the duration is 4x: ' || t.zone_pct;
  perform settle_trade(t.id, 1.0);
  t := open_trade(u, acc, 'EURUSD', 'inzone', 'up', 10, 1.00000, 60);
  assert t.direction is null and t.zone_pct = 0.018590, 'inzone zone stored, no direction: ' || t.zone_pct;
  t := settle_trade(t.id, 1.00018);   -- +0.018% inside
  assert t.result = 'win' and t.return_amount = 21, 'inside corridor wins 2.1x';
  t := settle_trade((open_trade(u, acc, 'EURUSD', 'inzone', null, 10, 1.00000, 60)).id, 0.99980); -- -0.02% outside
  assert t.result = 'loss' and t.return_amount = 0, 'outside corridor loses';
end $$;

-- ── Forex: P&L = amount*leverage*move, loss capped at the stake ──
do $$
declare
  u uuid := (select v from t_ids where k = 'a');
  acc uuid := (select v from t_ids where k = 'a_demo');
  t trades;
begin
  t := settle_trade((open_trade(u, acc, 'EURUSD', 'forex', 'up', 100, 1.00000, null, 100)).id, 1.00500);
  assert t.result = 'win' and t.return_amount = 150 and t.pnl = 50, 'forex +0.5% x100 = +50';
  t := settle_trade((open_trade(u, acc, 'EURUSD', 'forex', 'down', 100, 1.00000, null, 100)).id, 1.00200);
  assert t.return_amount = 80 and t.pnl = -20, 'forex short loses 20';
  t := settle_trade((open_trade(u, acc, 'EURUSD', 'forex', 'up', 100, 1.00000, null, 500)).id, 0.98000);
  assert t.return_amount = 0 and t.pnl = -100, 'stop-out never below zero';
end $$;

-- ── Refusals ──
do $$
declare
  u uuid := (select v from t_ids where k = 'a');
  acc uuid := (select v from t_ids where k = 'a_demo');
  ngn uuid := (select v from t_ids where k = 'a_ngn');
  other uuid := (select v from t_ids where k = 'b_demo');
  msg text;
begin
  begin perform open_trade(u, acc, 'EURUSD', 'fixed_time', 'up', 999999, 1.1, 5); msg := 'none';
  exception when others then msg := sqlerrm; end;
  assert msg = 'INSUFFICIENT_FUNDS', 'overspend refused: ' || msg;

  begin perform open_trade(u, ngn, 'EURUSD', 'fixed_time', 'up', 1, 1.1, 5); msg := 'none';
  exception when others then msg := sqlerrm; end;
  assert msg = 'LIVE_TRADING_DISABLED', 'live account refused: ' || msg;

  begin perform open_trade(u, other, 'EURUSD', 'fixed_time', 'up', 1, 1.1, 5); msg := 'none';
  exception when others then msg := sqlerrm; end;
  assert msg = 'ACCOUNT_NOT_FOUND', 'cannot trade from another user''s wallet: ' || msg;

  begin perform open_trade(u, acc, 'BTCUSD', 'forex', 'up', 1, 68000, null, 51); msg := 'none';
  exception when others then msg := sqlerrm; end;
  assert msg = 'INVALID_LEVERAGE', 'leverage above asset max refused: ' || msg;

  begin perform open_trade(u, acc, 'EURUSD', 'fixed_time', 'up', 1, 1.1, 4); msg := 'none';
  exception when others then msg := sqlerrm; end;
  assert msg = 'INVALID_DURATION', 'duration under 5s refused: ' || msg;

  begin perform open_trade(u, acc, 'EURUSD', 'fixed_time', 'up', 0.5, 1.1, 5); msg := 'none';
  exception when others then msg := sqlerrm; end;
  assert msg = 'INVALID_AMOUNT', 'amount under 1 refused: ' || msg;
end $$;

-- ── Demo reset: refused with open trades, otherwise restores 10000 ──
do $$
declare
  u uuid := (select v from t_ids where k = 'a');
  acc uuid := (select v from t_ids where k = 'a_demo');
  t trades; msg text;
begin
  t := open_trade(u, acc, 'EURUSD', 'fixed_time', 'up', 5, 1.1, 60);
  begin perform reset_demo(u); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'OPEN_TRADES_EXIST', 'reset refused while trades open';
  perform settle_trade(t.id, 1.0);
  perform reset_demo(u);
  assert (select balance from accounts where id = acc) = 10000, 'demo reset to 10000';
end $$;

-- ── Deposits credit once per reference; promo bonus once ──
do $$
declare
  u uuid := (select v from t_ids where k = 'a');
  ngn uuid := (select v from t_ids where k = 'a_ngn');
  msg text;
begin
  insert into transactions (user_id, account_id, type, status, amount, reference)
  values (u, ngn, 'deposit', 'pending', 5000, 'ref-1');
  begin perform credit_deposit('ref-1', 4000); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'AMOUNT_MISMATCH', 'wrong amount refused';
  perform credit_deposit('ref-1', 5000);
  perform credit_deposit('ref-1', 5000);   -- webhook retry
  assert (select balance from accounts where id = ngn) = 5000, 'deposit credited exactly once';

  perform credit_bonus(ngn, 1500, 'bonus', 'promo:ALPHA30:' || u, 'ALPHA30');
  perform credit_bonus(ngn, 1500, 'bonus', 'promo:ALPHA30:' || u, 'ALPHA30');
  assert (select balance from accounts where id = ngn) = 6500, 'promo bonus credited once';
  assert (select uses from promo_codes where code = 'ALPHA30') = 1, 'promo use counted once';
end $$;

-- ── Withdrawals: refused while live is off / without KYC; reject returns funds; approve clears them ──
do $$
declare
  u uuid := (select v from t_ids where k = 'a');
  ngn uuid := (select v from t_ids where k = 'a_ngn');
  pm uuid; tx transactions; msg text;
begin
  insert into payout_methods (user_id, kind, bank_code, account_number) values (u, 'bank', '058', '0123456789') returning id into pm;

  begin perform request_withdrawal(u, ngn, 2000, pm); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'LIVE_TRADING_DISABLED', 'withdrawal refused while live is off';

  update platform_settings set live_trading_enabled = true;
  begin perform request_withdrawal(u, ngn, 2000, pm); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'KYC_REQUIRED', 'withdrawal needs KYC';

  update profiles set kyc_status = 'verified', is_admin = true where id = u;
  tx := request_withdrawal(u, ngn, 2000, pm);
  assert (select balance from accounts where id = ngn) = 4500 and (select locked from accounts where id = ngn) = 2000, 'funds locked';
  perform resolve_withdrawal(tx.id, false, u, 'test reject');
  assert (select balance from accounts where id = ngn) = 6500 and (select locked from accounts where id = ngn) = 0, 'reject returns funds';

  tx := request_withdrawal(u, ngn, 2000, pm);
  perform resolve_withdrawal(tx.id, true, u);
  assert (select balance from accounts where id = ngn) = 4500 and (select locked from accounts where id = ngn) = 0, 'approve clears funds';

  begin perform resolve_withdrawal(tx.id, true, u); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'ALREADY_RESOLVED', 'cannot resolve twice';
end $$;

-- ── Ledger matches every balance: balance + locked = sum of completed transactions ──
do $$
begin
  assert not exists (
    select 1 from accounts a
    where a.balance + a.locked <> coalesce((select sum(amount) from transactions t
                                            where t.account_id = a.id and t.status = 'completed'), 0)
  ), 'ledger does not match balances';
end $$;

-- ── RLS: a signed-in user sees only their own rows and can never move money ──
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', (select v::text from t_ids where k = 'b'), true); end $$;
do $$
declare msg text;
begin
  assert (select count(*) from accounts) = 3, 'B sees only own 3 wallets';
  assert (select count(*) from trades) = 0, 'B cannot see A''s trades';
  assert (select count(*) from transactions where amount <> 10000) = 0, 'B cannot see A''s ledger';
  assert (select count(*) from assets) >= 75, 'assets are public (full market list)';

  begin update accounts set balance = 1e9; msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg like 'permission denied%', 'balance write blocked: ' || msg;

  begin perform reset_demo(auth.uid()); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg like 'permission denied%', 'money functions blocked for users: ' || msg;

  begin update profiles set active_account_id = (select v from t_ids where k = 'a_demo'); msg := 'none';
  exception when others then msg := sqlerrm; end;
  assert msg like 'new row violates row-level security%', 'cannot point profile at another user''s wallet: ' || msg;

  update profiles set active_account_id = (select id from accounts where type = 'NGN');
  assert (select a.type from profiles p join accounts a on a.id = p.active_account_id) = 'NGN', 'can switch to own wallet';
end $$;
reset role;

rollback;
