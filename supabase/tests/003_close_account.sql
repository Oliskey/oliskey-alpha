-- Delete account rules. Runs in one transaction and rolls back.
begin;

create temp table t_ids (k text primary key, v uuid);
insert into auth.users (email, raw_user_meta_data) values ('del-a@test.local', '{"full_name":"Del A"}');
insert into t_ids select 'a', id from auth.users where email = 'del-a@test.local';
insert into t_ids select 'demo', a.id from accounts a join t_ids t on t.k = 'a' and a.user_id = t.v where a.type = 'DEMO';
insert into t_ids select 'ngn', a.id from accounts a join t_ids t on t.k = 'a' and a.user_id = t.v where a.type = 'NGN';

do $$
declare
  u    uuid := (select v from t_ids where k = 'a');
  demo uuid := (select v from t_ids where k = 'demo');
  ngn  uuid := (select v from t_ids where k = 'ngn');
  t    trades;
  p    profiles;
  msg  text;
begin
  -- refused with an open trade
  t := open_trade(u, demo, 'EURUSD', 'fixed_time', 'up', 100, 1.11620, 60);
  begin perform close_account(u); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'ACCOUNT_HAS_OPEN_TRADES', 'open trade blocks deletion: ' || msg;
  perform settle_trade(t.id, 1.11600);

  -- refused while real money is on the NGN wallet
  update accounts set balance = 500 where id = ngn;
  insert into transactions (user_id, account_id, type, amount, balance_after, completed_at) values (u, ngn, 'deposit', 500, 500, now());
  begin perform close_account(u); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'WITHDRAW_FUNDS_FIRST', 'money must be withdrawn first: ' || msg;

  -- refused while money is locked in a pending withdrawal
  update accounts set balance = 0, locked = 500 where id = ngn;
  begin perform close_account(u); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg = 'WITHDRAW_FUNDS_FIRST', 'pending withdrawal blocks deletion: ' || msg;

  -- withdrawn: deletion anonymises the person, keeps trades and ledger, zeroes demo through the ledger
  update accounts set locked = 0 where id = ngn;
  insert into transactions (user_id, account_id, type, amount, balance_after, completed_at) values (u, ngn, 'withdrawal', -500, 0, now());
  p := close_account(u);
  assert p.deleted_at is not null and p.full_name is null and p.phone is null and not p.is_admin, 'profile anonymised';
  assert (select email from auth.users where id = u) like 'deleted-%@deleted.invalid', 'email anonymised';
  assert (select encrypted_password from auth.users where id = u) is null, 'cannot log in again';
  assert (select balance from accounts where id = demo) = 0, 'demo credits removed';
  assert (select count(*) from trades where user_id = u) = 1, 'trades kept';
  assert not exists (
    select 1 from accounts a where a.user_id = u and a.balance + a.locked <>
      (select coalesce(sum(amount), 0) from transactions x where x.account_id = a.id and x.status = 'completed')
  ), 'ledger still matches every balance';
  assert (close_account(u)).deleted_at = p.deleted_at, 'deleting twice changes nothing';
end $$;

set local role authenticated;
do $$
declare msg text;
begin
  begin perform close_account(gen_random_uuid()); msg := 'none'; exception when others then msg := sqlerrm; end;
  assert msg like 'permission denied%', 'users cannot call it directly: ' || msg;
end $$;
reset role;

rollback;
