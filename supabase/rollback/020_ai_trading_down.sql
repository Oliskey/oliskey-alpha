-- Rollback for 020_ai_trading.sql. Removes Oliskey AI Trading completely; no table outside the `trading` schema exists
-- in that migration, so nothing else is affected.
-- WARNING: this deletes every AI Trading record (connections, orders, fills, invoices, ledger). On a database with real
-- customers, export the schema first:  pg_dump --schema=trading "$DATABASE_URL" > trading-backup.sql
-- Run only with written approval from the owner.
begin;
drop schema if exists trading cascade;
commit;
