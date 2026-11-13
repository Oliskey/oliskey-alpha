// Scheduled AI Trading housekeeping (leader only; roadmap step 2.4). Each job is safe to run twice and records what it changed.
//   orders:        orders whose result is not final are asked again from the exchange (the source of truth); fills recorded once
//   keys:          every active key is re-checked; a key that can now withdraw or transfer is stopped (verifyConnection)
//   subscriptions: a paid month that ended becomes 'expired' (or 'cancelled' when the customer asked); allocations on it pause
import { pool } from '../db.js';
import { adapterForConnection, recordFills, verifyConnection } from './service.js';

const OPEN_STATES = ['new', 'pending', 'unknown', 'partially_filled'];

/** Orders not final after a minute: ask the exchange; record fills; give up after a day as 'failed' for a person to check. */
export async function reconcileOrders({ client = pool, deps = {} } = {}) {
  const { rows } = await client.query(
    `select o.*, c.id as conn_id from trading.trading_orders o join trading.exchange_connections c on c.id = o.connection_id
      where o.status = any($1) and o.created_at < now() - interval '1 minute' and c.revoked_at is null order by o.created_at limit 100`, [OPEN_STATES]);
  let checked = 0, settled = 0;
  for (const o of rows) {
    checked++;
    try {
      const { rows: [conn] } = await client.query('select * from trading.exchange_connections where id = $1', [o.conn_id]);
      const ex = deps.adapterFor?.(conn) ?? adapterForConnection(conn, deps);
      const st = await ex.orderStatus(o.symbol, o.client_order_id);
      if (!st) {
        if (new Date(o.created_at) < new Date(Date.now() - 86_400_000)) {
          await client.query(`update trading.trading_orders set status = 'failed', status_detail = 'Not found on the exchange after a day', updated_at = now() where id = $1`, [o.id]);
          await client.query(`insert into trading.system_events (kind, severity, message, details) values ('order_reconcile', 'error', 'Order not found on the exchange after a day', $1)`, [{ order: o.id }]);
        }
        continue;
      }
      await client.query('update trading.trading_orders set status = $2, exchange_order_id = coalesce($3, exchange_order_id), updated_at = now() where id = $1', [o.id, st.status, st.exchangeOrderId ?? null]);
      if (st.exchangeOrderId && (st.status === 'filled' || st.status === 'partially_filled')) { await recordFills({ id: o.id }, ex, { client }); settled++; }
    } catch (e) {
      await client.query(`insert into trading.system_events (kind, severity, message, details) values ('order_reconcile', 'error', $1, $2)`, [String(e.code || e.message).slice(0, 200), { order: o.id }]);
    }
  }
  return { checked, settled };
}

/** Re-checks active keys at most every 6 hours each. */
export async function recheckKeys({ client = pool, deps = {} } = {}) {
  const { rows } = await client.query(`select id, user_id from trading.exchange_connections
    where status = 'active' and revoked_at is null and (last_verified_at is null or last_verified_at < now() - interval '6 hours') limit 50`);
  let stopped = 0;
  for (const c of rows) {
    try { const r = await verifyConnection({ userId: c.user_id, id: c.id }, { client, ...deps }); if (r?.status && r.status !== 'active') stopped++; }
    catch { /* network trouble: tried again next round; the risk engine still checks every order */ }
  }
  return { checked: rows.length, stopped };
}

/** Ends paid months. Payment is never assumed: renewing means paying again (verified with Paystack). */
export async function expireSubscriptions({ client = pool } = {}) {
  const { rows } = await client.query(
    `update trading.strategy_subscriptions set status = case when cancel_at_period_end then 'cancelled' else 'expired' end, updated_at = now()
      where status in ('active', 'past_due') and current_period_end < now() returning user_id, strategy_id, status`);
  for (const s of rows) {
    await client.query(`update trading.strategy_allocations set status = 'paused', updated_at = now() where user_id = $1 and strategy_id = $2 and status = 'active'`, [s.user_id, s.strategy_id]);
  }
  return { ended: rows.length };
}

export function startTradingJobs() {
  if (process.env.TRADING_JOBS === 'off') return;
  const every = (ms, name, fn) => {
    let busy = false;
    setInterval(async () => {
      if (busy) return; busy = true;
      try { await fn(); } catch (e) { console.error(`trading job ${name}`, e.message); } finally { busy = false; }
    }, ms).unref();
  };
  every(2 * 60_000, 'orders', reconcileOrders);
  every(30 * 60_000, 'keys', recheckKeys);
  every(10 * 60_000, 'subscriptions', expireSubscriptions);
}
