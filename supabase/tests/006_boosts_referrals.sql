-- Boosts and referrals. Runs in one transaction and rolls back.
begin;

do $$
declare
  a uuid; b uuid; c uuid; acc uuid; usdt uuid; t trades; msg text; code text; n int; ref_tx transactions; pm uuid;
  start_bal numeric;
begin
  insert into auth.users (email) values ('br-a@test.local') returning id into a;
  insert into auth.users (email) values ('br-b@test.local') returning id into b;
  insert into auth.users (email) values ('br-c@test.local') returning id into c;
  select id into acc from accounts where user_id = a and type = 'DEMO';
  select id into usdt from accounts where user_id = a and type = 'USDT';

  -- no boost: normal payout
  t := open_trade(a, acc, 'EURUSD', 'fixed_time', 'up', 10, 1.11620, 60);
  start_bal := t.payout_pct;
  t := apply_boost(t.id, a);
  assert not t.boosted and t.payout_pct = start_bal, 'no boost, no change';

  begin perform activate_boost(a); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'NO_BOOST_AVAILABLE', 'nothing to activate: ' || msg;

  -- the same reason grants once; two different reasons grant two
  assert grant_boost(a, 'task:x'), 'first grant';
  assert not grant_boost(a, 'task:x'), 'same reason never grants twice';
  assert grant_boost(a, 'task:y'), 'second reason';
  perform activate_boost(a);
  begin perform activate_boost(a); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'BOOST_ALREADY_ACTIVE', 'one at a time: ' || msg;

  -- an active boost raises a Fixed Time payout by 10 points, once, and the win pays the raised rate
  t := open_trade(a, acc, 'EURUSD', 'fixed_time', 'up', 100, 1.11620, 60);
  t := apply_boost(t.id, a);
  assert t.boosted and t.payout_pct = start_bal + 10, 'boosted';
  t := apply_boost(t.id, a);
  assert t.payout_pct = start_bal + 10, 'not boosted twice';
  t := settle_trade(t.id, 1.11640);
  assert t.result = 'win' and t.return_amount = 100 + 100 * (start_bal + 10) / 100, 'win pays the boosted rate: ' || t.return_amount;

  -- InZone is not boosted
  t := open_trade(a, acc, 'EURUSD', 'inzone', null, 10, 1.11620, 60);
  t := apply_boost(t.id, a);
  assert not t.boosted, 'inzone unchanged';

  -- an expired boost does nothing
  update user_boosts set expires_at = now() - interval '1 minute' where user_id = a and status = 'active';
  t := open_trade(a, acc, 'EURUSD', 'fixed_time', 'up', 10, 1.11620, 60);
  t := apply_boost(t.id, a);
  assert not t.boosted, 'expired boost ignored';

  -- another person cannot boost someone else's trade
  begin perform apply_boost(t.id, b); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'TRADE_NOT_FOUND', 'other user refused: ' || msg;

  -- referral: bad codes and your own code do nothing; a good code links once
  select referral_code into code from profiles where id = a;
  assert not set_referrer(b, 'NOPE'), 'unknown code';
  assert not set_referrer(a, code), 'own code';
  assert set_referrer(b, lower(code)), 'good code, any case';
  assert not set_referrer(b, code), 'links once';
  assert (select count(*) from referral_rewards where referrer_id = a) = 1, 'one reward row';

  -- friend's first finished trade earns the inviter one boost, once
  assert referral_on_trade(b) = a, 'inviter earns a boost';
  assert referral_on_trade(b) is null, 'only once';
  assert referral_on_trade(c) is null, 'not invited: nothing';

  -- REAL-MONEY GATE: live off, nothing is paid, however qualified the friend is
  update profiles set kyc_status = 'verified' where id = b;
  insert into transactions (user_id, account_id, type, status, amount, reference)
    select b, id, 'deposit', 'completed', 5000, 'test-dep' from accounts where user_id = b and type = 'NGN';
  assert release_referral_bonuses() = 0, 'live off pays nothing';
  assert (select balance from accounts where id = usdt) = 0, 'no money while live is off';

  -- live on, but the friend has not qualified: nothing
  update platform_settings set live_trading_enabled = true;
  update profiles set kyc_status = 'none' where id = b;
  assert release_referral_bonuses() = 0, 'unverified friend pays nothing';
  update profiles set kyc_status = 'verified' where id = b;
  delete from transactions where reference = 'test-dep';
  assert release_referral_bonuses() = 0, 'no deposit pays nothing';
  insert into transactions (user_id, account_id, type, status, amount, reference)
    select b, id, 'deposit', 'completed', 5000, 'test-dep' from accounts where user_id = b and type = 'NGN';

  -- qualified: paid exactly once
  assert release_referral_bonuses() = 1, 'pays when qualified';
  assert release_referral_bonuses() = 0, 'pays once';
  assert (select balance from accounts where id = usdt) = 100 and (select bonus_locked from accounts where id = usdt) = 100, 'USD 100 marked as bonus';

  -- the bonus cannot be withdrawn, profits can
  update profiles set kyc_status = 'verified' where id = a;
  insert into payout_methods (user_id, kind, wallet_address, network) values (a, 'wallet', 'test', 'TRC20') returning id into pm;
  begin perform request_withdrawal(a, usdt, 10, pm); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'BONUS_NOT_WITHDRAWABLE', 'bonus stays: ' || msg;
  update accounts set balance = balance + 85 where id = usdt;   -- stands in for profit from trading the bonus
  insert into transactions (user_id, account_id, type, amount, completed_at) values (a, usdt, 'payout', 85, now());
  ref_tx := request_withdrawal(a, usdt, 85, pm);
  assert ref_tx.amount = -85, 'profit can be withdrawn';
  begin perform request_withdrawal(a, usdt, 1, pm); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'BONUS_NOT_WITHDRAWABLE', 'only the profit: ' || msg;

  raise notice 'PASS 006_boosts_referrals';
end $$;

rollback;
