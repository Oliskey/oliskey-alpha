-- Orders by time (009): exactly one trigger kind per order. Runs in one transaction and rolls back.
begin;

do $$
declare
  u   uuid;
  acc uuid;
  msg text;
begin
  insert into auth.users (email) values ('ot-a@test.local') returning id into u;
  select id into acc from accounts where user_id = u and type = 'DEMO';

  -- a time order: trigger_at set, no price
  insert into pending_orders (user_id, account_id, asset_id, mode, direction, amount, duration_sec, trigger_at, trigger_when, expires_at)
  values (u, acc, 'EURUSD', 'fixed_time', 'up', 10, 60, now() + interval '1 hour', 'time', now() + interval '1 hour 1 minute');

  -- a price order still works as before
  insert into pending_orders (user_id, account_id, asset_id, mode, direction, amount, duration_sec, trigger_price, trigger_when, expires_at)
  values (u, acc, 'EURUSD', 'fixed_time', 'up', 10, 60, 1.2, 'above', now() + interval '1 day');

  -- a time order without a time is refused
  begin
    insert into pending_orders (user_id, account_id, asset_id, mode, direction, amount, duration_sec, trigger_when, expires_at)
    values (u, acc, 'EURUSD', 'fixed_time', 'up', 10, 60, 'time', now() + interval '1 day');
    msg := 'none';
  exception when check_violation then msg := 'refused'; end;
  assert msg = 'refused', 'time order needs trigger_at';

  -- a price order without a price is refused
  begin
    insert into pending_orders (user_id, account_id, asset_id, mode, direction, amount, duration_sec, trigger_when, expires_at)
    values (u, acc, 'EURUSD', 'fixed_time', 'up', 10, 60, 'above', now() + interval '1 day');
    msg := 'none';
  exception when check_violation then msg := 'refused'; end;
  assert msg = 'refused', 'price order needs trigger_price';

  -- both triggers at once is refused
  begin
    insert into pending_orders (user_id, account_id, asset_id, mode, direction, amount, duration_sec, trigger_price, trigger_at, trigger_when, expires_at)
    values (u, acc, 'EURUSD', 'fixed_time', 'up', 10, 60, 1.2, now() + interval '1 hour', 'time', now() + interval '1 day');
    msg := 'none';
  exception when check_violation then msg := 'refused'; end;
  assert msg = 'refused', 'only one trigger kind';

  raise notice 'PASS 005_order_by_time';
end $$;

rollback;
