-- The live-trading waiting list: one row per person, the app's database roles cannot see or change it,
-- leaving keeps the row with left_at, and a deleted account leaves no trace. Runs in one transaction and rolls back.
begin;

do $$
declare a uuid; n int; ok boolean;
begin
  insert into auth.users (email) values ('wl-a@test.local') returning id into a;

  insert into trading.live_waitlist (user_id) values (a);
  begin
    insert into trading.live_waitlist (user_id) values (a);
    raise exception 'a second row for the same person was accepted';
  exception when unique_violation then null; end;

  begin
    update trading.live_waitlist set left_at = joined_at - interval '1 minute' where user_id = a;
    raise exception 'leaving before joining was accepted';
  exception when check_violation then null; end;

  select relrowsecurity into ok from pg_class where oid = 'trading.live_waitlist'::regclass;
  assert ok, 'row security is on';
  assert not has_table_privilege('authenticated', 'trading.live_waitlist', 'select'), 'signed-in app role cannot read it';
  assert not has_table_privilege('anon', 'trading.live_waitlist', 'insert'), 'anonymous role cannot add to it';

  delete from auth.users where id = a;
  select count(*) into n from trading.live_waitlist where user_id = a;
  assert n = 0, 'a deleted account leaves no row';
  raise notice 'PASS 009_live_waitlist';
end $$;

rollback;
