-- A pending order can carry a take profit and stop loss (money amounts, as on trades), so a signal that waits for its
-- entry price opens with both already set. Additive: existing orders keep null and behave as before.
alter table public.pending_orders
  add column if not exists take_profit numeric(20,8) check (take_profit is null or take_profit > 0),
  add column if not exists stop_loss   numeric(20,8) check (stop_loss is null or stop_loss > 0);
