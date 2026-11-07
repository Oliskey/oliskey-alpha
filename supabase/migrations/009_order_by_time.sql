-- 009: pending orders can also open at a chosen time ("By time"), not only at a price ("By price").
-- Owner request 2026-10-30 (Order: By price / By time). Additive: existing price orders are unchanged.
--  * trigger_when = 'time'  -> the trade opens at trigger_at (server clock, server price at that moment)
--  * trigger_when = 'above' / 'below' -> as before, the trade opens when the price reaches trigger_price
-- Nothing is reserved until the order fills; the trade still opens only through open_trade.

alter table public.pending_orders add column if not exists trigger_at timestamptz;
alter table public.pending_orders alter column trigger_price drop not null;

alter table public.pending_orders drop constraint if exists pending_orders_trigger_when_check;
alter table public.pending_orders add constraint pending_orders_trigger_when_check
  check (trigger_when in ('above', 'below', 'time'));

-- exactly one kind of trigger per order
alter table public.pending_orders drop constraint if exists pending_orders_trigger_kind;
alter table public.pending_orders add constraint pending_orders_trigger_kind check (
  (trigger_when = 'time' and trigger_at is not null and trigger_price is null)
  or (trigger_when in ('above', 'below') and trigger_price is not null and trigger_at is null)
);
