-- Second lock on the AI engine's tables (roadmap 4.2, owner approved 2026-11-13). The app's database roles already have no access
-- to schema intel; this also turns on row security with no policies, so even a future grant by mistake shows them nothing.
-- The AI engine and the backend own these tables and are not affected (row security does not apply to a table's owner).
-- The intel tables are created by the AI engine (intel/engine/db.py), so this runs over whatever exists; it is safe to repeat.
do $$
declare t record;
begin
  if not exists (select 1 from pg_namespace where nspname = 'intel') then return; end if;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'intel' and c.relkind = 'r' loop
    execute format('alter table intel.%I enable row level security', t.relname);
    execute format('revoke all on intel.%I from public, anon, authenticated', t.relname);
  end loop;
  revoke all on schema intel from public, anon, authenticated;
  alter default privileges in schema intel revoke all on tables from public, anon, authenticated;
end $$;
