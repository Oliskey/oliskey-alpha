-- Second lock on the AI engine's tables (roadmap 4.2, owner approved 2026-11-13). The app's database roles already have no access
-- to schema intel; this also turns on row security with no policies, so even a future grant by mistake shows them nothing.
-- The AI engine and the backend own these tables and are not affected (row security does not apply to a table's owner).
-- The intel tables are created by the AI engine (intel/engine/db.py), so this runs over whatever exists; it is safe to repeat.
-- The live AI engine writes to these tables all the time, so each table is given a short lock wait and a few retries.
set statement_timeout = '15min';
do $$
declare t record; tries int;
begin
  if not exists (select 1 from pg_namespace where nspname = 'intel') then return; end if;
  perform set_config('lock_timeout', '10s', true);
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'intel' and c.relkind = 'r' and not c.relrowsecurity loop
    tries := 0;
    loop
      begin
        execute format('alter table intel.%I enable row level security', t.relname);
        exit;
      exception when lock_not_available then
        tries := tries + 1;
        if tries >= 12 then raise; end if;
        perform pg_sleep(2);
      end;
    end loop;
    execute format('revoke all on intel.%I from public, anon, authenticated', t.relname);
  end loop;
  revoke all on schema intel from public, anon, authenticated;
  alter default privileges in schema intel revoke all on tables from public, anon, authenticated;
end $$;
