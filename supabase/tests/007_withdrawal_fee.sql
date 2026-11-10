-- Withdrawal fee (15% by default) and failed bank transfers. Runs in one transaction and rolls back.
begin;

do $$
declare
  u uuid; adm uuid; ngn uuid; pm uuid; tx transactions; msg text;
  ledger_ok boolean;
begin
  insert into auth.users (email) values ('fee-u@test.local') returning id into u;
  insert into auth.users (email) values ('fee-admin@test.local') returning id into adm;
  update profiles set is_admin = true where id = adm;
  update profiles set kyc_status = 'verified' where id = u;
  select id into ngn from accounts where user_id = u and type = 'NGN';
  insert into payout_methods (user_id, kind, bank_code, account_number) values (u, 'bank', '058', '0123456789') returning id into pm;
  update platform_settings set live_trading_enabled = true;

  insert into transactions (user_id, account_id, type, status, amount, reference) values (u, ngn, 'deposit', 'pending', 10000, 'fee-dep');
  perform credit_deposit('fee-dep', 10000);
  assert (select balance from accounts where id = ngn) = 10000, 'funded';

  -- the default rate is 15%: asking for 4,000 sends 3,400 to the bank and 600 is the fee
  assert (select withdrawal_fee_pct from platform_settings where id) = 15, 'default 15%';
  tx := request_withdrawal(u, ngn, 4000, pm);
  assert (tx.metadata ->> 'fee')::numeric = 600 and (tx.metadata ->> 'payout')::numeric = 3400 and (tx.metadata ->> 'fee_pct')::numeric = 15,
    'fee and payout stored on the request: ' || tx.metadata::text;
  assert (select balance from accounts where id = ngn) = 6000 and (select locked from accounts where id = ngn) = 4000, 'whole amount locked';

  -- a rate change after the request does not change what this user was shown
  update platform_settings set withdrawal_fee_pct = 20;
  perform resolve_withdrawal(tx.id, true, adm);
  assert (select amount from platform_revenue where transaction_id = tx.id) = 600, 'fee booked at the rate shown';
  assert (select balance from accounts where id = ngn) = 6000 and (select locked from accounts where id = ngn) = 0, 'approve clears the lock';
  update platform_settings set withdrawal_fee_pct = 15;

  -- rejected: everything comes back, no revenue
  tx := request_withdrawal(u, ngn, 2000, pm);
  perform resolve_withdrawal(tx.id, false, adm, 'test');
  assert (select balance from accounts where id = ngn) = 6000, 'reject returns the whole amount, fee included';
  assert not exists (select 1 from platform_revenue where transaction_id = tx.id), 'no fee on a rejected withdrawal';

  -- the bank transfer fails after approval: the whole amount comes back once, and the fee is cancelled
  tx := request_withdrawal(u, ngn, 2000, pm);
  perform resolve_withdrawal(tx.id, true, adm);
  assert (select balance from accounts where id = ngn) = 4000, 'approved';
  perform reverse_withdrawal(tx.id, 'transfer.failed');
  perform reverse_withdrawal(tx.id, 'transfer.failed');   -- webhook retry
  assert (select balance from accounts where id = ngn) = 6000, 'returned once: ' || (select balance from accounts where id = ngn);
  assert (select status from transactions where id = tx.id) = 'failed', 'marked failed';
  assert (select reversed_at is not null from platform_revenue where transaction_id = tx.id), 'fee revenue cancelled';

  -- reversing a pending withdrawal does nothing (the admin has not approved it)
  tx := request_withdrawal(u, ngn, 2000, pm);
  perform reverse_withdrawal(tx.id, 'transfer.failed');
  assert (select status from transactions where id = tx.id) = 'pending', 'pending untouched';
  perform resolve_withdrawal(tx.id, false, adm);

  -- limits: rate between 0 and 50; 0% means no fee row
  begin update platform_settings set withdrawal_fee_pct = 51; msg := 'none'; exception when others then msg := 'refused'; end;
  assert msg = 'refused', 'rate above 50% refused';
  update platform_settings set withdrawal_fee_pct = 0;
  tx := request_withdrawal(u, ngn, 1000, pm);
  perform resolve_withdrawal(tx.id, true, adm);
  assert not exists (select 1 from platform_revenue where transaction_id = tx.id), 'no fee row at 0%';
  update platform_settings set withdrawal_fee_pct = 15;

  -- the ledger still matches every balance
  select not exists (
    select 1 from accounts a
    where a.balance + a.locked <> coalesce((select sum(amount) from transactions t where t.account_id = a.id and t.status = 'completed'), 0)
  ) into ledger_ok;
  assert ledger_ok, 'ledger does not match balances';

  -- the app's own database role cannot read revenue
  assert not has_table_privilege('authenticated', 'public.platform_revenue', 'select'), 'revenue hidden from the app role';
  assert not has_function_privilege('authenticated', 'public.reverse_withdrawal(uuid, text)', 'execute'), 'only the backend can reverse';

  raise notice 'PASS 007_withdrawal_fee';
end $$;

rollback;
