// Opening a trade, shared by POST /trades and the pending-order watcher so both validate and price it the same way.
// The open quote is always the server's current price. A risk-free request is applied in the same database
// transaction: if the daily allowance is used up, no trade is opened at all.
import { pool } from './db.js';
import { isUuid } from './http.js';

export const MODES = ['fixed_time', 'inzone', 'forex'];

// Returns an error message for the app, or null when the order is well-formed.
export function orderError(o, engine) {
  const { accountId, assetId, mode, direction, amount, durationSec, leverage, takeProfit, stopLoss, riskFree } = o ?? {};
  if (!isUuid(accountId)) return 'Choose an account.';
  if (!engine.has(assetId)) return 'This asset is not available right now.';
  if (!MODES.includes(mode)) return 'Choose a trading mode.';
  if (mode !== 'inzone' && !['up', 'down'].includes(direction)) return 'Choose Up or Down.';
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 'Enter an amount.';
  if (mode !== 'forex' && !Number.isInteger(durationSec)) return 'Choose a duration.';
  if (mode === 'forex' && !Number.isInteger(leverage)) return 'Choose a multiplier.';
  for (const v of [takeProfit, stopLoss]) {
    if (v != null && !(typeof v === 'number' && v > 0)) return 'Take profit and stop loss must be positive amounts.';
  }
  if (riskFree != null && typeof riskFree !== 'boolean') return 'Risk-free must be on or off.';
  if (riskFree && mode === 'forex') return 'Risk-free is available for Fixed Time and InZone trades.';
  return null;
}

export async function openTrade({ userId, order, engine, settlement }) {
  const { accountId, assetId, mode, direction, amount, durationSec, leverage, takeProfit, stopLoss, riskFree, ideaId, ideaEndsAt, auto } = order;
  // New users learn before they trade (owner decision 2026-11-07). Checked here, so no route, order or AI can get round it.
  const { rows: learner } = await pool.query('select onboarded_at from profiles where id = $1', [userId]);
  if (!learner[0]?.onboarded_at) throw Object.assign(new Error('NOT_ONBOARDED'), { status: 403 });
  const tick = engine.getPrice(assetId);
  if (!tick) throw Object.assign(new Error('NO_PRICE'), { status: 400 });
  if (!engine.isFresh(assetId)) throw Object.assign(new Error('NO_PRICE'), { status: 400 });   // never open on an old price
  const client = await pool.connect();
  try {
    await client.query('begin');
    let { rows } = await client.query(
      'select * from open_trade($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
      [userId, accountId, assetId, mode, mode === 'inzone' ? null : direction, amount, tick.price,
        mode === 'forex' ? null : durationSec, mode === 'forex' ? leverage : null,
        mode === 'forex' ? takeProfit ?? null : null, mode === 'forex' ? stopLoss ?? null : null],
    );
    // Live markets: the corridor comes from real recent volatility. The asset's fixed setting only fits the simulator.
    if (mode === 'inzone' && engine.isLive(assetId)) {
      const zone = engine.liveZonePct(assetId, durationSec);
      if (zone == null) throw Object.assign(new Error('ZONE_UNAVAILABLE'), { status: 400 });
      ({ rows } = await client.query('update trades set zone_pct = $2 where id = $1 returning *', [rows[0].id, zone]));
    }
    if (riskFree) ({ rows } = await client.query('select * from make_trade_risk_free($1, $2)', [rows[0].id, userId]));
    // A trade the AI placed by itself: it never uses up the person's boost.
    if (auto) ({ rows } = await client.query('update trades set auto = true where id = $1 returning *', [rows[0].id]));
    else ({ rows } = await client.query('select * from apply_boost($1, $2)', [rows[0].id, userId]));   // an active boost raises this payout
    if (ideaId != null) ({ rows } = await client.query('update trades set idea_id = $2, idea_ends_at = $3 where id = $1 returning *', [rows[0].id, ideaId, ideaEndsAt]));
    await client.query('commit');
    settlement.add(rows[0]);
    return rows[0];
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
