-- Oliskey AI Trading: database safety rules. Runs in one transaction and rolls back.
begin;

do $$
declare
  a uuid; b uuid; adm uuid; conn uuid; inv uuid; e uuid := gen_random_uuid(); msg text; n int;
begin
  insert into auth.users (email) values ('at-a@test.local') returning id into a;
  insert into auth.users (email) values ('at-b@test.local') returning id into b;
  insert into auth.users (email) values ('at-admin@test.local') returning id into adm;

  -- 1. an approval cannot be completed without evidence and a named approver
  begin
    update trading.admin_approvals set status = 'approved' where area = 'regulatory_legal' and subject = 'platform';
    raise exception 'approval without evidence was accepted';
  exception when check_violation then null; end;
  update trading.admin_approvals set status = 'approved', evidence_url = 'https://example.com/opinion.pdf',
    evidence_note = 'Opinion letter', updated_by = adm where area = 'regulatory_legal' and subject = 'platform';
  select count(*) into n from trading.admin_approval_history h join trading.admin_approvals ap on ap.id = h.approval_id
    where ap.area = 'regulatory_legal' and h.status = 'approved';
  assert n = 1, 'approval history recorded';

  -- 2. an exchange cannot go live while approvals or adapter tests are missing; live switch needs a live exchange
  begin
    update trading.exchange_providers set live_enabled = true where id = 'binance';
    raise exception 'live exchange without approvals was accepted';
  exception when raise_exception then
    get stacked diagnostics msg = message_text; assert msg like 'LIVE_NOT_ALLOWED%', msg;
  end;
  begin
    update trading.controls set live_trading_enabled = true;
    raise exception 'live switch without a live exchange was accepted';
  exception when raise_exception then
    get stacked diagnostics msg = message_text; assert msg like 'LIVE_NOT_ALLOWED%', msg;
  end;

  -- 3. one active connection per exchange and environment; never two
  insert into trading.exchange_connections (user_id, provider_id, environment, key_hint, credentials_ciphertext, credentials_key_id)
    values (a, 'binance', 'testnet', '…abcd', 'x', 'k1') returning id into conn;
  begin
    insert into trading.exchange_connections (user_id, provider_id, environment, key_hint, credentials_ciphertext, credentials_key_id)
      values (a, 'binance', 'testnet', '…efgh', 'y', 'k1');
    raise exception 'second active connection accepted';
  exception when unique_violation then null; end;

  -- 4. the same idempotency key never creates a second order
  insert into trading.trading_orders (user_id, connection_id, strategy_id, environment, symbol, side, type, quote_quantity, idempotency_key, client_order_id)
    values (a, conn, 'strict_swing', 'testnet', 'BTCUSDT', 'buy', 'market', 100, 'idem-1', 'oat-1');
  begin
    insert into trading.trading_orders (user_id, connection_id, strategy_id, environment, symbol, side, type, quote_quantity, idempotency_key, client_order_id)
      values (a, conn, 'strict_swing', 'testnet', 'BTCUSDT', 'buy', 'market', 100, 'idem-1', 'oat-2');
    raise exception 'duplicate order accepted';
  exception when unique_violation then null; end;

  -- 5. long-only: a position can never go below zero
  begin
    insert into trading.positions (user_id, strategy_id, environment, symbol, quantity) values (a, 'strict_swing', 'paper', 'BTCUSDT', -1);
    raise exception 'short position accepted';
  exception when check_violation then null; end;

  -- 6. fills, ledger, risk events and audit logs cannot be changed or deleted
  insert into trading.trade_fills (order_id, exchange_fill_id, price, quantity, quote_quantity, fee, fee_asset, fee_quote, filled_at)
    select id, 'f1', 50000, 0.002, 100, 0.1, 'USDT', 0.1, now() from trading.trading_orders where idempotency_key = 'idem-1';
  begin
    update trading.trade_fills set price = 1;
    raise exception 'fill was changed';
  exception when raise_exception then
    get stacked diagnostics msg = message_text; assert msg like 'APPEND_ONLY%', msg;
  end;
  begin
    truncate trading.security_audit_logs;
    raise exception 'audit log was truncated';
  exception when raise_exception then
    get stacked diagnostics msg = message_text; assert msg like 'APPEND_ONLY%', msg;
  end;

  -- 7. commission invoice: rate is 15%, eligible profit equals the rise of the high-water mark
  begin
    insert into trading.commission_invoices (user_id, realised_net_profit, previous_hwm, new_hwm, eligible_profit, rate, commission, customer_share)
      values (a, 1000, 0, 1000, 1000, 0.20, 200, 800);
    raise exception 'a 20 percent invoice was accepted';
  exception when check_violation then null; end;
  begin
    insert into trading.commission_invoices (user_id, realised_net_profit, previous_hwm, new_hwm, eligible_profit, commission, customer_share)
      values (a, 1000, 400, 1000, 1000, 150, 850);
    raise exception 'eligible profit above the mark rise was accepted';
  exception when check_violation then null; end;
  insert into trading.commission_invoices (user_id, realised_net_profit, previous_hwm, new_hwm, eligible_profit, commission, customer_share)
    values (a, 1000, 400, 1000, 600, 90, 510) returning id into inv;
  -- an invoice can be paid only once
  insert into trading.commission_payments (invoice_id, provider, reference, amount, currency, status, verified_at)
    values (inv, 'paystack', 'cp-1', 90, 'USD', 'success', now());
  begin
    insert into trading.commission_payments (invoice_id, provider, reference, amount, currency, status, verified_at)
      values (inv, 'paystack', 'cp-2', 90, 'USD', 'success', now());
    raise exception 'second successful payment accepted';
  exception when unique_violation then null; end;
  begin
    insert into trading.commission_payments (invoice_id, provider, reference, amount, currency, status)
      values (inv, 'paystack', 'cp-3', 90, 'USD', 'success');
    raise exception 'success without verification accepted';
  exception when check_violation then null; end;

  -- 8. Row Level Security: customer B sees none of customer A's rows, and nobody reads the encrypted key
  perform set_config('request.jwt.claim.sub', b::text, true);
  set local role authenticated;
  select count(*) into n from trading.trading_orders; assert n = 0, 'B cannot see A''s orders';
  select count(*) into n from trading.exchange_connections; assert n = 0, 'B cannot see A''s connections';
  select count(*) into n from trading.commission_invoices; assert n = 0, 'B cannot see A''s invoices';
  begin
    perform credentials_ciphertext from trading.exchange_connections;
    raise exception 'encrypted key column was readable';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from trading.account_ledger;
    raise exception 'ledger readable by customers';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  select count(*) into n from trading.trading_orders; assert n = 1, 'A sees own order';
  select count(*) into n from trading.trading_strategies; assert n = 4, 'catalogue visible';
  begin
    insert into trading.trading_orders (user_id, strategy_id, environment, symbol, side, type, quote_quantity, idempotency_key, client_order_id)
      values (a, 'strict_swing', 'paper', 'BTCUSDT', 'buy', 'market', 1, 'idem-x', 'oat-x');
    raise exception 'customer wrote an order directly';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- 9. the ledger must balance per entry (checked at commit, so test with set constraints immediate)
do $$
declare e uuid := gen_random_uuid(); r uuid := gen_random_uuid(); msg text;
begin
  set constraints trading.account_ledger_balanced immediate;
  -- both legs in one statement: the check runs at the end of the statement
  insert into trading.account_ledger (entry_id, account, debit, credit, currency, memo, ref_type, ref_id) values
    (e, 'cash_paystack', 100, 0, 'USD', 'test', 'test', r), (e, 'revenue_subscriptions', 0, 100, 'USD', 'test', 'test', r);
  begin
    insert into trading.account_ledger (entry_id, account, debit, currency, memo, ref_type, ref_id) values (gen_random_uuid(), 'cash_paystack', 50, 'USD', 'one-sided', 'test', r);
    raise exception 'unbalanced ledger entry accepted';
  exception when raise_exception then
    get stacked diagnostics msg = message_text; assert msg like 'LEDGER_UNBALANCED%', msg;
  end;
end $$;

rollback;
