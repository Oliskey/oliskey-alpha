// Pending orders: the user picks a trigger price (By price) or a moment (By time); this watcher opens the trade
// (through openTrade, at the server's price) the moment the market reaches the price or the clock reaches the time. Nothing is reserved until then; if the account can't pay when the order
// fills, the order is marked failed with the reason. Orders not filled before they expire are marked expired.
import { Router } from 'express';
import { pool } from './db.js';
import { isUuid, messageFor } from './http.js';
import { notify } from './notify.js';
import { openTrade, orderError } from './openTrade.js';

const LOOP_MS = 250;
const MAX_LIFETIME_H = 24 * 7;
const MAX_PENDING_PER_USER = 20;
const MIN_LEAD_MS = 10_000;        // a time order must be at least 10 s ahead
const TIME_GRACE_MS = 60_000;      // a time order that could not open within 1 min of its time expires

export function startOrders({ engine, settlement, push }) {
  const pending = new Map();   // id -> order row
  let busy = false;
  const load = async () => {
    const { rows } = await pool.query("select * from pending_orders where status = 'pending'");
    pending.clear();
    for (const o of rows) pending.set(o.id, o);
  };
  const resolve = async (o, status, extra = {}) => {
    const { rows } = await pool.query(
      `update pending_orders set status = $2, fail_reason = $3, trade_id = $4, resolved_at = now()
       where id = $1 and status = 'pending' returning *`, [o.id, status, extra.reason ?? null, extra.tradeId ?? null]);
    pending.delete(o.id);
    if (rows[0]) {
      push(o.user_id, { type: 'order_update', order: rows[0], trade: extra.trade ?? null });
      const asset = o.asset_id;
      if (status === 'filled') void notify(o.user_id, 'activities', 'Your order opened', `${asset}: the trade is now running.`, '/trades');
      if (status === 'failed') void notify(o.user_id, 'activities', 'Your order could not open', `${asset}: ${extra.reason ?? 'please try again.'}`, '/trades');
      if (status === 'expired') void notify(o.user_id, 'activities', 'Your order expired', o.trigger_when === 'time' ? `${asset}: it could not open at the chosen time.` : `${asset}: the price did not reach your opening price in time.`, '/trades');
    }
  };
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = Date.now();
      for (const o of [...pending.values()]) {
        if (new Date(o.expires_at).getTime() <= now) { await resolve(o, 'expired'); continue; }
        const price = engine.getPrice(o.asset_id)?.price;
        if (price == null) continue;
        const hit = o.trigger_when === 'time' ? new Date(o.trigger_at).getTime() <= now
          : o.trigger_when === 'above' ? price >= Number(o.trigger_price) : price <= Number(o.trigger_price);
        if (!hit) continue;
        try {
          const trade = await openTrade({
            userId: o.user_id, engine, settlement,
            order: { accountId: o.account_id, assetId: o.asset_id, mode: o.mode, direction: o.direction, amount: Number(o.amount),
              durationSec: o.duration_sec, leverage: o.leverage, riskFree: o.risk_free,
              takeProfit: o.take_profit == null ? undefined : Number(o.take_profit), stopLoss: o.stop_loss == null ? undefined : Number(o.stop_loss),
              ideaId: o.idea_id, ideaEndsAt: o.idea_ends_at },
          });
          await resolve(o, 'filled', { tradeId: trade.id, trade });
        } catch (err) {
          await resolve(o, 'failed', { reason: messageFor(err.message) });
        }
      }
    } catch (err) {
      console.error('orders', err.message);
    } finally {
      busy = false;
    }
  };
  const ready = load().then(() => setInterval(tick, LOOP_MS)).catch((err) => console.error('orders load', err.message));
  return { add: (o) => pending.set(o.id, o), remove: (id) => pending.delete(id), ready };
}

export function ordersRouter({ engine, orders }) {
  const r = Router();

  // Place: the trade that opens later, plus what triggers it: a price ("above" fills when the price rises to it) or
  // a time (triggerAt, ISO date or ms; up to 7 days ahead).
  r.post('/orders', async (req, res) => {
    const { triggerPrice, triggerAt, expiresInHours = 24 } = req.body ?? {};
    const err = orderError(req.body, engine);
    if (err) return res.status(400).json({ error: err });
    const byTime = triggerAt != null;
    let at = null;
    if (byTime) {
      at = new Date(triggerAt);
      if (Number.isNaN(at.getTime())) return res.status(400).json({ error: 'Pick the time that opens the trade.' });
      if (at.getTime() < Date.now() + MIN_LEAD_MS) return res.status(400).json({ error: 'Pick a time at least a few seconds from now.' });
      if (at.getTime() > Date.now() + MAX_LIFETIME_H * 3600_000) return res.status(400).json({ error: `An order can wait up to ${MAX_LIFETIME_H / 24} days.` });
    } else {
      if (typeof triggerPrice !== 'number' || !(triggerPrice > 0)) return res.status(400).json({ error: 'Enter the price that opens the trade.' });
      if (typeof expiresInHours !== 'number' || expiresInHours <= 0 || expiresInHours > MAX_LIFETIME_H) {
        return res.status(400).json({ error: `An order can wait up to ${MAX_LIFETIME_H / 24} days.` });
      }
    }
    const now = engine.getPrice(req.body.assetId)?.price;
    if (now == null) return res.status(400).json({ error: 'No price is available for this asset right now.' });
    if (!byTime && triggerPrice === now) return res.status(400).json({ error: 'Pick a price above or below the current price.' });
    const own = await pool.query('select 1 from accounts where id = $1 and user_id = $2', [req.body.accountId, req.user.id]);
    if (!own.rowCount) return res.status(400).json({ error: 'Account not found.' });
    const count = await pool.query("select count(*)::int as n from pending_orders where user_id = $1 and status = 'pending'", [req.user.id]);
    if (count.rows[0].n >= MAX_PENDING_PER_USER) return res.status(400).json({ error: `You can have up to ${MAX_PENDING_PER_USER} pending orders.` });
    const b = req.body;
    const { rows } = await pool.query(
      `insert into pending_orders (user_id, account_id, asset_id, mode, direction, amount, duration_sec, leverage, risk_free,
                                   trigger_price, trigger_at, trigger_when, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning *`,
      [req.user.id, b.accountId, b.assetId, b.mode, b.mode === 'inzone' ? null : b.direction, b.amount,
        b.mode === 'forex' ? null : b.durationSec, b.mode === 'forex' ? b.leverage : null, !!b.riskFree,
        byTime ? null : triggerPrice, at, byTime ? 'time' : triggerPrice > now ? 'above' : 'below',
        byTime ? new Date(at.getTime() + TIME_GRACE_MS) : new Date(Date.now() + expiresInHours * 3600_000)]);
    orders.add(rows[0]);
    res.status(201).json(rows[0]);
  });

  r.get('/orders', async (req, res) => {
    const status = ['pending', 'filled', 'cancelled', 'expired', 'failed'].includes(req.query.status) ? req.query.status : null;
    const { rows } = await pool.query(
      `select * from pending_orders where user_id = $1 ${status ? 'and status = $2' : ''} order by created_at desc limit 100`,
      status ? [req.user.id, status] : [req.user.id]);
    res.json(rows);
  });

  r.delete('/orders/:id', async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Order not found.' });
    const { rows } = await pool.query(
      `update pending_orders set status = 'cancelled', resolved_at = now()
       where id = $1 and user_id = $2 and status = 'pending' returning *`, [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'This order is no longer pending.' });
    orders.remove(rows[0].id);
    res.json(rows[0]);
  });

  return r;
}
