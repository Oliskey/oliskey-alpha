// Oliskey AI Trading: database-backed operations used by the routes and the trading loop.
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { adapterFor, hasAdapter } from './exchanges/index.js';
import { EXCHANGE_MESSAGES, SYMBOLS } from './exchanges/adapter.js';
import { seal, open, keyHint } from './vault.js';
import { D, add, sub, str, sum } from './decimal.js';
import { replayPosition, commission, statement } from './money.js';
import { checkOrder, checkAllocations } from './risk.js';

export class TradingError extends Error {
  constructor(code, status = 400, message = EXCHANGE_MESSAGES[code] || code) { super(message); this.code = code; this.status = status; }
}

export async function audit(client, actorId, action, target, details = {}, ip = null) {
  await client.query('insert into trading.security_audit_logs (actor_id, action, target, ip, details) values ($1, $2, $3, $4, $5)',
    [actorId, action, target, ip, details]);
}

// ───────────────────────── Connections ─────────────────────────
const PUBLIC_CONN = 'id, provider_id, environment, label, key_hint, permissions, status, status_detail, last_verified_at, last_sync_at, created_at';

// The risk disclosure customers accept before real money (docs/ai-trading/legal/03-risk-disclosure.md). A new text gets a new
// version, and everyone must accept it again.
export const RISK_DISCLOSURE_VERSION = '2026-11-13';

/** Before a real-money key: identity verified (Paystack BVN check) and the current risk disclosure accepted (append-only log). */
export async function realMoneyReady(client, userId) {
  const [{ rows: [p] }, { rows: [acc] }] = await Promise.all([
    client.query('select kyc_status from profiles where id = $1', [userId]),
    client.query(`select 1 from trading.security_audit_logs where actor_id = $1 and action = 'risk_disclosure.accepted' and details->>'version' = $2 limit 1`, [userId, RISK_DISCLOSURE_VERSION]),
  ]);
  if (p?.kyc_status !== 'verified') throw new TradingError('IDENTITY_REQUIRED', 403, 'Verify your identity first (Profile > Verify identity). It is needed before real money.');
  if (!acc) throw new TradingError('RISK_DISCLOSURE_REQUIRED', 403, 'Read and accept the risk disclosure first. It is needed before real money.');
}

/** Checks the key with the exchange BEFORE storing it; a key that can withdraw or transfer is refused and never stored. */
export async function connectExchange({ userId, providerId, environment, apiKey, apiSecret, passphrase, label, ip }, deps = {}) {
  const { client = pool, fetchImpl } = deps;
  const { rows: [prov] } = await client.query('select * from trading.exchange_providers where id = $1', [providerId]);
  if (!prov || !hasAdapter(providerId)) throw new TradingError('UNSUPPORTED', 400, 'This exchange is not available yet.');
  if (environment === 'live' && !prov.live_enabled) throw new TradingError('LIVE_NOT_AVAILABLE', 403, `Live trading on ${prov.name} is not open yet. You can connect a testnet key.`);
  if (environment === 'live') await realMoneyReady(client, userId);
  if (prov.requires_passphrase && !passphrase) throw new TradingError('PASSPHRASE_REQUIRED', 400, 'This exchange needs the API passphrase too.');
  const credentials = { apiKey, apiSecret, passphrase };
  let perms;
  try {
    perms = await adapterFor(providerId, { environment, credentials, fetchImpl }).verifyPermissions();
  } catch (e) {
    await audit(client, userId, 'exchange.connect_failed', providerId, { environment, reason: e.code }, ip);
    throw new TradingError(e.code === 'INVALID_KEY' ? 'INVALID_KEY' : (e.code || 'NETWORK'), e.code === 'INVALID_KEY' ? 400 : 502);
  }
  if (perms.forbidden.length) {
    await audit(client, userId, 'exchange.key_refused', providerId, { environment, forbidden: perms.forbidden }, ip);
    throw Object.assign(new TradingError('FORBIDDEN_PERMISSION', 400), { forbidden: perms.forbidden });
  }
  if (!perms.ok) throw new TradingError('MISSING_PERMISSION', 400);
  const owner = { userId, providerId, environment };
  const sealed = seal(credentials, owner);
  const db = await client.connect();
  try {
    await db.query('begin');
    // one active key per exchange and environment: the old one is revoked when a new one is connected
    await db.query(`update trading.exchange_connections set status = 'revoked', revoked_at = now(), credentials_ciphertext = 'revoked'
      where user_id = $1 and provider_id = $2 and environment = $3 and revoked_at is null`, [userId, providerId, environment]);
    const { rows: [row] } = await db.query(
      `insert into trading.exchange_connections (user_id, provider_id, environment, label, key_hint, credentials_ciphertext, credentials_key_id,
         permissions, status, last_verified_at) values ($1, $2, $3, $4, $5, $6, $7, $8, 'active', now()) returning ${PUBLIC_CONN}`,
      [userId, providerId, environment, label || null, keyHint(apiKey), sealed.ciphertext, sealed.keyId, perms]);
    await audit(db, userId, 'exchange.connected', providerId, { environment, connection: row.id, warnings: perms.warnings }, ip);
    await db.query('commit');
    return row;
  } catch (e) { await db.query('rollback').catch(() => {}); throw e; } finally { db.release(); }
}

async function connectionRow(client, userId, id) {
  const { rows: [c] } = await client.query('select * from trading.exchange_connections where id = $1 and user_id = $2 and revoked_at is null', [id, userId]);
  if (!c) throw new TradingError('NOT_FOUND', 404, 'Connection not found.');
  return c;
}

export function adapterForConnection(c, deps = {}) {
  const credentials = open({ ciphertext: c.credentials_ciphertext, keyId: c.credentials_key_id }, { userId: c.user_id, providerId: c.provider_id, environment: c.environment });
  return adapterFor(c.provider_id, { environment: c.environment, credentials, fetchImpl: deps.fetchImpl });
}

export async function verifyConnection({ userId, id }, deps = {}) {
  const { client = pool } = deps;
  const c = await connectionRow(client, userId, id);
  let status = 'active', detail = null, perms = c.permissions;
  try {
    perms = await adapterForConnection(c, deps).verifyPermissions();
    if (perms.forbidden.length) { status = 'invalid'; detail = 'Key now allows withdrawals or transfers. Trading is stopped for it.'; }
    else if (!perms.ok) { status = 'invalid'; detail = EXCHANGE_MESSAGES.MISSING_PERMISSION; }
  } catch (e) {
    status = e.code === 'INVALID_KEY' ? 'invalid' : 'error'; detail = EXCHANGE_MESSAGES[e.code] || 'Check failed.';
  }
  const { rows: [row] } = await client.query(
    `update trading.exchange_connections set status = $3, status_detail = $4, permissions = $5,
       last_verified_at = case when $3 = 'active' then now() else last_verified_at end
     where id = $1 and user_id = $2 returning ${PUBLIC_CONN}`, [id, userId, status, detail, perms]);
  if (status !== 'active') {
    await client.query(`update trading.strategy_allocations set status = 'paused', updated_at = now() where connection_id = $1`, [id]);
    await client.query(`insert into public.notifications (user_id, title, body) values ($1, 'Exchange connection needs attention', $2)`, [userId, detail]).catch(() => {});
  }
  return row;
}

export async function disconnect({ userId, id, ip }, { client = pool } = {}) {
  const c = await connectionRow(client, userId, id);
  await client.query(`update trading.exchange_connections set status = 'revoked', revoked_at = now(), credentials_ciphertext = 'revoked' where id = $1`, [id]);
  await client.query(`update trading.strategy_allocations set status = 'paused', updated_at = now() where connection_id = $1`, [id]);
  await audit(client, userId, 'exchange.disconnected', c.provider_id, { connection: id }, ip);
  const { rows: [p] } = await client.query('select name, key_settings_url from trading.exchange_providers where id = $1', [c.provider_id]);
  return { revoked: true, instructions: `We deleted the key from Oliskey. To finish, delete the key on ${p.name} too.`, keySettingsUrl: p.key_settings_url };
}

export async function listConnections(userId, { client = pool } = {}) {
  return (await client.query(`select ${PUBLIC_CONN} from trading.exchange_connections where user_id = $1 and revoked_at is null order by created_at`, [userId])).rows;
}

// ───────────────────────── Allocations ─────────────────────────
/** Sets one strategy's capital. Combined allocations on a connection may not exceed the USDT the exchange reports. */
export async function allocate({ userId, strategyId, connectionId, amount }, deps = {}) {
  const { client = pool } = deps;
  if (!/^\d+(\.\d{1,8})?$/.test(String(amount))) throw new TradingError('INVALID_AMOUNT', 400, 'Enter an amount in USDT.');
  const { rows: [sub_] } = await client.query(`select 1 from trading.strategy_subscriptions where user_id = $1 and strategy_id = $2 and status = 'active' and current_period_end > now()`, [userId, strategyId]);
  if (!sub_) throw new TradingError('SUBSCRIPTION_REQUIRED', 402, 'Subscribe to this strategy first.');
  const c = await connectionRow(client, userId, connectionId);
  if (c.status !== 'active') throw new TradingError('CONNECTION_NOT_ACTIVE', 409, 'Check the exchange connection first.');
  const balances = await adapterForConnection(c, deps).balances();
  const usdt = balances.find((b) => b.asset === 'USDT');
  const capital = usdt ? add(usdt.free, usdt.locked) : 0n;
  const { rows: others } = await client.query('select amount from trading.strategy_allocations where connection_id = $1 and strategy_id <> $2', [connectionId, strategyId]);
  const check = checkAllocations([...others, { amount: String(amount) }], capital);
  if (!check.ok) throw new TradingError('ALLOCATION_TOO_HIGH', 400, `Your strategies would use ${check.total} USDT, but the exchange reports ${check.capital} USDT.`);
  const { rows: [row] } = await client.query(
    `insert into trading.strategy_allocations (user_id, strategy_id, connection_id, amount) values ($1, $2, $3, $4)
     on conflict (user_id, strategy_id, connection_id) do update set amount = excluded.amount, updated_at = now() returning *`,
    [userId, strategyId, connectionId, String(amount)]);
  await client.query('update trading.exchange_connections set last_sync_at = now() where id = $1', [connectionId]);
  return row;
}

// ───────────────────────── Commission ─────────────────────────
/** Realised net profit on live money, recomputed from the stored fills (never from a stored total). */
export async function realisedFromFills(userId, { client = pool, environment = 'live' } = {}) {
  const { rows } = await client.query(
    `select o.strategy_id, o.symbol, o.side, f.price, f.quantity, f.quote_quantity, f.fee, f.fee_asset, f.fee_quote
       from trading.trade_fills f join trading.trading_orders o on o.id = f.order_id
      where o.user_id = $1 and o.environment = $2 order by f.filled_at, f.recorded_at`, [userId, environment]);
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.strategy_id}|${r.symbol}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ side: r.side, price: r.price, quantity: r.quantity, quoteQuantity: r.quote_quantity, fee: r.fee, feeAsset: r.fee_asset, feeQuote: r.fee_quote });
  }
  const positions = [...groups].map(([k, fills]) => { const [strategyId, symbol] = k.split('|'); return { strategyId, symbol, ...replayPosition(fills, SYMBOLS[symbol].base) }; });
  return { positions, realised: sum(positions.map((p) => p.realised)) };
}

/**
 * The customer declares a withdrawal (or asks to settle): an invoice is issued for 15% of realised net profit above the
 * high-water mark. Locked per customer so two declarations cannot both charge the same profit.
 */
export async function declareWithdrawal({ userId, amount, note, ip }, { client = pool } = {}) {
  const db = await client.connect();
  try {
    await db.query('begin');
    await db.query(`insert into trading.high_water_marks (user_id, environment) values ($1, 'live') on conflict do nothing`, [userId]);
    const { rows: [h] } = await db.query(`select level from trading.high_water_marks where user_id = $1 and environment = 'live' for update`, [userId]);
    const { realised } = await realisedFromFills(userId, { client: db });
    const c = commission({ cumulativeRealised: realised, hwm: h.level });
    const declaration = { amount: amount ?? null, note: note ?? null, declared_at: new Date().toISOString() };
    if (!c.due) {
      await db.query('commit');
      return { invoice: null, message: 'No commission is due: there is no new realised profit above what was already charged.', ...c };
    }
    const { rows: [inv] } = await db.query(
      `insert into trading.commission_invoices (user_id, realised_net_profit, previous_hwm, new_hwm, eligible_profit, commission, customer_share, declaration)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [userId, str(realised), c.previousHwm, c.newHwm, c.eligible, c.commission, c.customerShare, declaration]);
    await db.query(`update trading.high_water_marks set level = $2, updated_at = now() where user_id = $1 and environment = 'live'`, [userId, c.newHwm]);
    await audit(db, userId, 'commission.invoice_issued', inv.number, { commission: c.commission }, ip);
    await db.query('commit');
    return { invoice: inv, ...c };
  } catch (e) { await db.query('rollback').catch(() => {}); throw e; } finally { db.release(); }
}

export async function financialStatement(userId, { client = pool, prices = {} } = {}) {
  const { positions } = await realisedFromFills(userId, { client });
  const { rows: [h] } = await client.query(`select level from trading.high_water_marks where user_id = $1 and environment = 'live'`, [userId]);
  const { rows: [snap] } = await client.query(`select starting_capital, exchange_balance from trading.profit_snapshots where user_id = $1 and environment = 'live' order by as_of desc limit 1`, [userId]);
  const { rows: invoices } = await client.query(`select number, commission, status, issued_at, paid_at from trading.commission_invoices where user_id = $1 order by issued_at desc`, [userId]);
  const paid = sum(invoices.filter((i) => i.status === 'paid').map((i) => i.commission));
  return {
    ...statement({
      startingCapital: snap?.starting_capital ?? '0', exchangeBalance: snap?.exchange_balance ?? '0', positions, prices,
      hwm: h?.level ?? '0', paidCommission: str(paid), openInvoices: invoices.filter((i) => i.status === 'issued'),
    }),
    balanceReported: Boolean(snap), invoices,
  };
}

// ───────────────────────── Orders ─────────────────────────
/** Today's realised loss (UTC day) across the customer's strategies, from the stored fills; 0 when today is a gain. */
async function todaysLoss(client, userId, environment, nowMs) {
  const since = Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate());
  const { rows } = await client.query(
    `select o.strategy_id, o.symbol, o.side, f.price, f.quantity, f.quote_quantity, f.fee, f.fee_asset, f.fee_quote, extract(epoch from f.filled_at) * 1000 as t
       from trading.trade_fills f join trading.trading_orders o on o.id = f.order_id
      where o.user_id = $1 and o.environment = $2 order by f.filled_at, f.recorded_at`, [userId, environment]);
  const groups = new Map();
  for (const r of rows) { const k = `${r.strategy_id}|${r.symbol}`; (groups.get(k) || groups.set(k, []).get(k)).push({ side: r.side, price: r.price, quantity: r.quantity, quoteQuantity: r.quote_quantity, fee: r.fee, feeAsset: r.fee_asset, feeQuote: r.fee_quote, time: Number(r.t), symbol: r.symbol }); }
  const today = sum([...groups.values()].map((f) => replayPosition(f, SYMBOLS[f[0].symbol].base, { since }).realisedSince));
  return today < 0n ? str(-today) : '0';
}
async function loadLimits(client, userId, strategyId) {
  const { rows } = await client.query(
    `select * from trading.risk_limits where (scope = 'platform' and scope_id = '*') or (scope = 'user' and scope_id = $1) or (scope = 'strategy' and scope_id = $2)
     order by case scope when 'user' then 1 when 'strategy' then 2 else 3 end`, [userId, strategyId]);
  // the strictest value of each limit wins
  const pick = (f, low = true) => rows.map((r) => r[f]).reduce((a, b) => (a === undefined ? b : (low ? (D(String(b)) < D(String(a)) ? b : a) : a)), undefined);
  return {
    maxOrderQuote: String(pick('max_order_quote')), maxPositionQuote: String(pick('max_position_quote')), maxDailyLossQuote: String(pick('max_daily_loss_quote')),
    maxExposurePct: String(pick('max_exposure_pct')), maxConcurrentPositions: Math.min(...rows.map((r) => r.max_concurrent_positions)),
    maxSlippageBps: Math.min(...rows.map((r) => r.max_slippage_bps)), maxPriceAgeMs: Math.min(...rows.map((r) => r.max_price_age_ms)),
  };
}

/**
 * Takes a strategy's proposal for one customer through the deterministic risk engine and, only if approved, sends it
 * to the exchange. The order row (with its idempotency key and client order id) is written BEFORE the exchange call,
 * so a crash or retry finds the same order instead of placing another. Every decision is stored as a risk event.
 */
export async function placeStrategyOrder({ userId, strategyId, signalId, symbol, side, quoteAmount, quantity, refPrice, priceTime, idempotencyKey }, deps = {}) {
  const { client = pool, now = Date.now } = deps;
  const { rows: [alloc] } = await client.query(
    `select a.*, c.provider_id, c.environment, c.status as conn_status from trading.strategy_allocations a
       join trading.exchange_connections c on c.id = a.connection_id and c.revoked_at is null
      where a.user_id = $1 and a.strategy_id = $2 and a.status = 'active' limit 1`, [userId, strategyId]);
  if (!alloc || alloc.conn_status !== 'active') throw new TradingError('NO_ACTIVE_ALLOCATION', 409, 'No active allocation for this strategy.');
  if (alloc.environment === 'live') await realMoneyReady(client, userId);   // a newer disclosure must be accepted again
  const { rows: [conn] } = await client.query('select * from trading.exchange_connections where id = $1', [alloc.connection_id]);
  const ex = adapterForConnection(conn, deps);
  const [{ rows: [ctl] }, { rows: [uc] }, { rows: [prov] }, { rows: [subs] }, { rows: [ver] }, { rows: dup }, { rows: posRows }, loss, limits, live, balances, syms] = await Promise.all([
    client.query('select * from trading.controls'),
    client.query('select paused from trading.user_controls where user_id = $1', [userId]),
    client.query('select live_enabled from trading.exchange_providers where id = $1', [alloc.provider_id]),
    client.query(`select 1 as ok from trading.strategy_subscriptions where user_id = $1 and strategy_id = $2 and status = 'active' and current_period_end > now()`, [userId, strategyId]),
    client.query(`select 1 as ok from trading.strategy_versions where strategy_id = $1 and status = any($2)`, [strategyId, alloc.environment === 'live' ? ['approved_live'] : ['approved_paper', 'approved_live']]),
    client.query('select 1 from trading.trading_orders where idempotency_key = $1', [idempotencyKey]),
    client.query(`select strategy_id, symbol, quantity, cost_basis from trading.positions where user_id = $1 and environment = $2 and status = 'open'`, [userId, alloc.environment]),
    todaysLoss(client, userId, alloc.environment, now()),
    loadLimits(client, userId, strategyId),
    ex.price(symbol),
    ex.balances(),
    ex.symbols(),
  ]);
  const usdt = balances.find((b) => b.asset === 'USDT');
  const prices = { [symbol]: live.price };
  const exposureOf = (rows) => str(sum(rows.map((r) => r.cost_basis)));
  const mine = posRows.filter((p) => p.strategy_id === strategyId && p.symbol === symbol);
  const ctx = {
    now: now(), environment: alloc.environment,
    controls: { platformPaused: ctl.platform_paused, emergencyStop: ctl.emergency_stop, liveEnabled: ctl.live_trading_enabled },
    exchangeLive: prov.live_enabled, userPaused: Boolean(uc?.paused), subscriptionActive: Boolean(subs), strategyApproved: Boolean(ver),
    limits, allocation: alloc.amount, strategyExposure: exposureOf(posRows.filter((p) => p.strategy_id === strategyId)), totalExposure: exposureOf(posRows),
    equity: str(add(usdt ? add(usdt.free, usdt.locked) : 0n, exposureOf(posRows))), availableQuote: usdt?.free ?? '0',
    holding: mine[0]?.quantity ?? '0', openPositions: posRows.length, dailyRealisedLoss: loss,
    livePrice: live, filters: syms.find((s) => s.symbol === symbol)?.filters, knownIdempotencyKeys: new Set(dup.length ? [idempotencyKey] : []),
  };
  const proposal = { userId, strategyId, symbol, side, quoteAmount, quantity, refPrice, priceTime, idempotencyKey };
  const verdict = checkOrder(proposal, ctx);
  await client.query(`insert into trading.risk_events (user_id, strategy_id, symbol, decision, rules, proposal) values ($1, $2, $3, $4, $5, $6)`,
    [userId, strategyId, symbol, verdict.approved ? 'approved' : 'rejected', JSON.stringify(verdict.rules), { ...proposal, prices }]);
  if (!verdict.approved) return { placed: false, rules: verdict.rules };

  const clientOrderId = 'oat' + randomUUID().replace(/-/g, '').slice(0, 29);
  const { rows: [order] } = await client.query(
    `insert into trading.trading_orders (user_id, connection_id, strategy_id, signal_id, environment, symbol, side, type, quantity, quote_quantity, idempotency_key, client_order_id)
     values ($1, $2, $3, $4, $5, $6, $7, 'market', $8, $9, $10, $11) on conflict (idempotency_key) do nothing returning *`,
    [userId, conn.id, strategyId, signalId || null, alloc.environment, symbol, side, side === 'sell' ? verdict.order.quantity : null, side === 'buy' ? verdict.order.notional : null, idempotencyKey, clientOrderId]);
  if (!order) return { placed: false, duplicate: true };
  let result;
  try {
    result = await ex.placeOrder({ symbol, side, type: 'market', clientOrderId, ...(side === 'buy' ? { quoteQuantity: verdict.order.notional } : { quantity: verdict.order.quantity }) });
  } catch (e) {
    const status = e.code === 'UNKNOWN_ORDER_STATE' ? 'unknown' : 'rejected';
    await client.query(`update trading.trading_orders set status = $2, status_detail = $3, updated_at = now() where id = $1`, [order.id, status, EXCHANGE_MESSAGES[e.code] || e.code]);
    return { placed: false, orderId: order.id, status, reason: e.code };
  }
  await client.query(`update trading.trading_orders set status = $2, exchange_order_id = $3, updated_at = now() where id = $1`, [order.id, result.status, result.exchangeOrderId || null]);
  if (result.exchangeOrderId && (result.status === 'filled' || result.status === 'partially_filled')) await recordFills(order, ex, { client });
  return { placed: true, orderId: order.id, status: result.status };
}

/** Pulls fills from the exchange (the source of truth) and rebuilds the position from all stored fills. */
export async function recordFills(order, ex, { client = pool } = {}) {
  const { rows: [o] } = await client.query('select * from trading.trading_orders where id = $1', [order.id]);
  const fills = await ex.fills(o.symbol, o.exchange_order_id);
  for (const f of fills) {
    const quote = f.quoteQuantity ?? str(D(f.price) * D(f.quantity) / 100_000_000n);
    const feeQuote = f.feeAsset === 'USDT' ? f.fee : f.feeAsset === SYMBOLS[o.symbol].base ? str(D(f.fee) * D(f.price) / 100_000_000n) : null;
    if (feeQuote === null) throw new TradingError('FEE_ASSET_UNPRICED', 500, `Fee paid in ${f.feeAsset} needs a price before it can be recorded.`);
    await client.query(
      `insert into trading.trade_fills (order_id, exchange_fill_id, price, quantity, quote_quantity, fee, fee_asset, fee_quote, filled_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9 / 1000.0)) on conflict (order_id, exchange_fill_id) do nothing`,
      [o.id, f.id, f.price, f.quantity, quote, f.fee, f.feeAsset, feeQuote, f.time ?? Date.now()]);
  }
  // rebuild this strategy's position for the symbol from every stored fill (one row per strategy and symbol; realised_pnl
  // is cumulative and is only a cache: commission is always recomputed from the fills)
  const { rows } = await client.query(
    `select o.side, f.price, f.quantity, f.quote_quantity, f.fee, f.fee_asset, f.fee_quote from trading.trade_fills f join trading.trading_orders o on o.id = f.order_id
      where o.user_id = $1 and o.strategy_id = $2 and o.symbol = $3 and o.environment = $4 order by f.filled_at, f.recorded_at`,
    [o.user_id, o.strategy_id, o.symbol, o.environment]);
  const p = replayPosition(rows.map((r) => ({ side: r.side, price: r.price, quantity: r.quantity, quoteQuantity: r.quote_quantity, fee: r.fee, feeAsset: r.fee_asset, feeQuote: r.fee_quote })), SYMBOLS[o.symbol].base);
  const open_ = p.quantity > 0n;
  const { rowCount } = await client.query(
    `update trading.positions set quantity = $5, cost_basis = $6, realised_pnl = $7, fees_quote = $8, updated_at = now(),
       status = case when $9 then 'open' else 'closed' end, closed_at = case when $9 then null else now() end
     where id = (select id from trading.positions where user_id = $1 and strategy_id = $2 and symbol = $3 and environment = $4 order by opened_at desc limit 1)`,
    [o.user_id, o.strategy_id, o.symbol, o.environment, str(p.quantity), str(p.costBasis), str(p.realised), str(p.fees), open_]);
  if (!rowCount) {
    await client.query(`insert into trading.positions (user_id, connection_id, strategy_id, environment, symbol, quantity, cost_basis, realised_pnl, fees_quote, status, closed_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [o.user_id, o.connection_id, o.strategy_id, o.environment, o.symbol, str(p.quantity), str(p.costBasis), str(p.realised), str(p.fees), open_ ? 'open' : 'closed', open_ ? null : new Date()]);
  }
  return p;
}

export const _test = { loadLimits, sub };
