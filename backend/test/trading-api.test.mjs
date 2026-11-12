// Oliskey AI Trading end to end against the real database and API, with Binance and Paystack answered by fakes (the
// exchange and the payment provider are not reachable from tests). Needs the server on API_URL for sign-up, and the
// same DATABASE_URL / SUPABASE_JWT_SECRET / TRADING_CREDENTIALS_* as the server.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { pool } from '../src/db.js';
import { requireAuth } from '../src/auth.js';
import { aiTradingRouter } from '../src/routes/aiTrading.js';
import { placeStrategyOrder } from '../src/trading/service.js';
import { settleTradingPayment, SUB_PREFIX } from '../src/trading/payments.js';

const API = process.env.API_URL || 'http://localhost:3311';
const KEY = 'tk_' + 'a'.repeat(30), SECRET = 'ts_' + 'b'.repeat(40);
let price = '50000', usdt = '5000', orderSeq = 0;
const placed = [];
const RUN = Date.now().toString(36);   // keys unique per run, so the suite can run again on the same database

// a fake Binance testnet: account, prices, rules, orders and fills
async function fakeFetch(url, init) {
  const u = new URL(url), p = Object.fromEntries(u.searchParams);
  if (init.headers?.['X-MBX-APIKEY'] && init.headers['X-MBX-APIKEY'] !== KEY) return res(401, { code: -2015, msg: 'Invalid API-key' });
  const route = `${init.method} ${u.pathname}`;
  if (route === 'GET /api/v3/account') return res(200, { canTrade: true, permissions: ['SPOT'], balances: [{ asset: 'USDT', free: usdt, locked: '0' }] });
  if (route === 'GET /api/v3/ticker/price') return res(200, { symbol: p.symbol, price });
  if (route === 'GET /api/v3/exchangeInfo') return res(200, { symbols: ['BTCUSDT', 'ETHUSDT'].map((s) => ({ symbol: s, baseAsset: s.slice(0, 3), quoteAsset: 'USDT', status: 'TRADING',
    filters: [{ filterType: 'LOT_SIZE', stepSize: '0.00001', minQty: '0.00001' }, { filterType: 'PRICE_FILTER', tickSize: '0.01' }, { filterType: 'NOTIONAL', minNotional: '5' }] })) });
  if (route === 'POST /api/v3/order') {
    const id = ++orderSeq; const qty = p.quantity ?? (Number(p.quoteOrderQty) / Number(price)).toFixed(5);
    placed.push({ id, ...p, qty, price });
    return res(200, { symbol: p.symbol, orderId: id, clientOrderId: p.newClientOrderId, side: p.side, type: 'MARKET', status: 'FILLED', executedQty: qty, cummulativeQuoteQty: String(Number(qty) * Number(price)) });
  }
  if (route === 'GET /api/v3/myTrades') {
    const o = placed.find((x) => String(x.id) === p.orderId);
    const quote = (Number(o.qty) * Number(o.price)).toFixed(8);
    return res(200, [{ id: o.id * 10, price: o.price, qty: o.qty, quoteQty: quote, commission: (Number(quote) * 0.001).toFixed(8), commissionAsset: 'USDT', time: Date.now(), isBuyer: o.side === 'BUY' }]);
  }
  return res(404, { code: -1, msg: 'unexpected ' + route });
}
const res = (status, body) => ({ status, headers: new Map(), text: async () => JSON.stringify(body) });

let base, server, token, userId;
const call = async (method, path, body, headers = {}) => {
  const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

before(async () => {
  const app = express(); app.use(express.json()); app.use(requireAuth); app.use('/trading', aiTradingRouter({ fetchImpl: fakeFetch }));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  const reg = await (await fetch(API + '/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'AI Trader', email: `oat${Date.now()}@test.local`, password: 'password123' }) })).json();
  token = reg.token;
  userId = (await pool.query(`select id from auth.users order by created_at desc limit 1`)).rows[0].id;
  // a strategy version approved for paper/testnet by a named approver with its test record
  await pool.query(`insert into trading.strategy_versions (strategy_id, version, config, status, backtest, approved_by, approved_at)
    values ('strict_swing', '1.0.0', '{}', 'approved_paper', '{"trades": 120, "period": "2022-2026"}', $1, now()) on conflict do nothing`, [userId]);
});
after(async () => { server?.close(); await pool.end(); });

let connId;
test('exchange marketplace: Binance on testnet only, the rest coming soon', async () => {
  const r = await call('GET', '/trading/exchanges');
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.map((e) => [e.id, e.availability]));
  assert.deepEqual(by, { binance: 'testnet_only', okx: 'coming_soon', bybit: 'coming_soon', kucoin: 'coming_soon', gateio: 'coming_soon' });
});

test('connecting: live refused until approved; a wrong key is refused; a good key is stored encrypted only', async () => {
  assert.equal((await call('POST', '/trading/exchanges/connect', { providerId: 'binance', environment: 'live', apiKey: KEY, apiSecret: SECRET })).status, 403);
  const wrong = await call('POST', '/trading/exchanges/connect', { providerId: 'binance', environment: 'testnet', apiKey: 'tk_' + 'z'.repeat(30), apiSecret: SECRET });
  assert.equal(wrong.status, 400); assert.equal(wrong.body.code, 'INVALID_KEY');
  const ok = await call('POST', '/trading/exchanges/connect', { providerId: 'binance', environment: 'testnet', apiKey: KEY, apiSecret: SECRET, label: 'Main' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  connId = ok.body.id;
  assert.equal(ok.body.key_hint, '…' + KEY.slice(-4));
  assert.ok(!JSON.stringify(ok.body).includes(SECRET) && !('credentials_ciphertext' in ok.body));
  const { rows: [row] } = await pool.query('select credentials_ciphertext from trading.exchange_connections where id = $1', [connId]);
  assert.ok(!row.credentials_ciphertext.includes(SECRET) && !row.credentials_ciphertext.includes(KEY));
  const audit = await pool.query(`select details::text from trading.security_audit_logs where actor_id = $1`, [userId]);
  assert.ok(audit.rows.every((a) => !a.details.includes(SECRET)));
});

test('allocation needs a paid subscription; payment is verified with Paystack, never trusted from the app', async () => {
  assert.equal((await call('POST', '/trading/strategies/allocate', { strategyId: 'strict_swing', connectionId: connId, amount: '1000' })).status, 402);
  const ref = SUB_PREFIX + crypto.randomUUID();
  const { rows: [pay] } = await pool.query(`insert into trading.subscription_payments (user_id, provider, reference, strategies, amount_usd, amount, currency, fx_rate)
    values ($1, 'paystack', $2, '{strict_swing}', 2.50, 3750.00, 'NGN', 1500) returning id`, [userId, ref]);
  await pool.query(`insert into trading.strategy_subscriptions (user_id, strategy_id, payment_id) values ($1, 'strict_swing', $2)`, [userId, pay.id]);
  // the app saying "paid" changes nothing; Paystack reporting less than the price fails the payment
  assert.equal((await settleTradingPayment(ref, { verify: async () => ({ status: 'abandoned', reference: ref }) })).status, 'not_paid');
  const ref2 = SUB_PREFIX + crypto.randomUUID();
  const { rows: [pay2] } = await pool.query(`insert into trading.subscription_payments (user_id, provider, reference, strategies, amount_usd, amount, currency, fx_rate)
    values ($1, 'paystack', $2, '{strict_swing}', 2.50, 3750.00, 'NGN', 1500) returning id`, [userId, ref2]);
  await pool.query(`update trading.strategy_subscriptions set payment_id = $2 where user_id = $1`, [userId, pay2.id]);
  const good = async () => ({ status: 'success', reference: ref2, currency: 'NGN', amount: 375000 });
  const [a, b] = await Promise.all([settleTradingPayment(ref2, { verify: good }), settleTradingPayment(ref2, { verify: good })]);   // webhook and app at once
  assert.deepEqual([a.status, b.status].sort(), ['success', 'success']);
  const { rows: ledger } = await pool.query(`select account, debit, credit from trading.account_ledger where ref_id = $1`, [pay2.id]);
  assert.equal(ledger.length, 2, 'booked once');
  const { rows: [s] } = await pool.query(`select status from trading.strategy_subscriptions where user_id = $1 and strategy_id = 'strict_swing'`, [userId]);
  assert.equal(s.status, 'active');
});

test('allocations cannot exceed the capital the exchange reports', async () => {
  const over = await call('POST', '/trading/strategies/allocate', { strategyId: 'strict_swing', connectionId: connId, amount: '6000' });
  assert.equal(over.status, 400); assert.match(over.body.error, /5000 USDT/);
  assert.equal((await call('POST', '/trading/strategies/allocate', { strategyId: 'strict_swing', connectionId: connId, amount: '2000' })).status, 200);
});

const proposal = (over) => ({ userId, strategyId: 'strict_swing', symbol: 'BTCUSDT', refPrice: price, priceTime: Date.now() - 1000, ...over });
test('an approved signal trades once; a repeat with the same key never places a second order', async () => {
  const r1 = await placeStrategyOrder(proposal({ side: 'buy', quoteAmount: '500', idempotencyKey: `sig-1-buy-${RUN}` }), { fetchImpl: fakeFetch });
  assert.equal(r1.placed, true, JSON.stringify(r1));
  const r2 = await placeStrategyOrder(proposal({ side: 'buy', quoteAmount: '500', idempotencyKey: `sig-1-buy-${RUN}` }), { fetchImpl: fakeFetch });
  assert.equal(r2.placed, false);
  assert.equal(placed.length, 1, 'exchange saw one order');
  const { rows: [pos] } = await pool.query(`select quantity, cost_basis from trading.positions where user_id = $1`, [userId]);
  assert.equal(Number(pos.quantity), 0.01);
});

test('risk refusals are recorded: emergency stop, stale price, short selling', async () => {
  await pool.query('update trading.controls set emergency_stop = true');
  const stop = await placeStrategyOrder(proposal({ side: 'buy', quoteAmount: '100', idempotencyKey: `sig-2-${RUN}` }), { fetchImpl: fakeFetch });
  await pool.query('update trading.controls set emergency_stop = false');
  assert.equal(stop.placed, false); assert.ok(stop.rules.find((x) => x.rule === 'emergency_stop' && !x.ok));
  const stale = await placeStrategyOrder(proposal({ side: 'buy', quoteAmount: '100', idempotencyKey: `sig-3-${RUN}`, priceTime: Date.now() - 600_000 }), { fetchImpl: fakeFetch });
  assert.equal(stale.placed, false);
  const short = await placeStrategyOrder(proposal({ side: 'sell', quantity: '5', idempotencyKey: `sig-4-${RUN}` }), { fetchImpl: fakeFetch });
  assert.equal(short.placed, true, 'sells only what is held');   // sized down to the holding, never below zero
  const { rows: [pos] } = await pool.query(`select quantity, status, realised_pnl from trading.positions where user_id = $1`, [userId]);
  assert.equal(Number(pos.quantity), 0); assert.equal(pos.status, 'closed');
  const { rows: [n] } = await pool.query(`select count(*)::int as n from trading.risk_events where user_id = $1 and decision = 'rejected'`, [userId]);
  assert.ok(n.n >= 2);
  assert.equal(placed.length, 2, 'the refused orders never reached the exchange');
});

test('commission: 15% of realised live profit above the high-water mark, invoiced once', async () => {
  // live fills recorded for this customer (as the exchange would report them): buy 0.1 at 50,000, sell at 60,000
  const { rows: [o1] } = await pool.query(`insert into trading.trading_orders (user_id, strategy_id, environment, symbol, side, type, quote_quantity, idempotency_key, client_order_id, status)
    values ($1, 'strict_swing', 'live', 'BTCUSDT', 'buy', 'market', 5000, $2, $3, 'filled') returning id`, [userId, `live-1-${RUN}`, `oat-live-1-${RUN}`]);
  const { rows: [o2] } = await pool.query(`insert into trading.trading_orders (user_id, strategy_id, environment, symbol, side, type, quantity, idempotency_key, client_order_id, status)
    values ($1, 'strict_swing', 'live', 'BTCUSDT', 'sell', 'market', 0.1, $2, $3, 'filled') returning id`, [userId, `live-2-${RUN}`, `oat-live-2-${RUN}`]);
  await pool.query(`insert into trading.trade_fills (order_id, exchange_fill_id, price, quantity, quote_quantity, fee, fee_asset, fee_quote, filled_at) values
    ($1, 'L1', 50000, 0.1, 5000, 5, 'USDT', 5, now() - interval '2 hours'), ($2, 'L2', 60000, 0.1, 6000, 6, 'USDT', 6, now() - interval '1 hour')`, [o1.id, o2.id]);
  const d1 = await call('POST', '/trading/commissions/withdrawal-declaration', { amount: '989', note: 'monthly' });
  assert.equal(d1.status, 201, JSON.stringify(d1.body));
  // profit 6,000 - 6 - 5,005 = 989 → 15% = 148.35; customer keeps 840.65
  assert.deepEqual([d1.body.invoice.eligible_profit, d1.body.invoice.commission, d1.body.invoice.customer_share], ['989.00000000', '148.35', '840.65000000']);
  const d2 = await call('POST', '/trading/commissions/withdrawal-declaration', {});
  assert.equal(d2.body.invoice, null, 'the same profit is never charged twice');
  const st = await call('GET', '/trading/financial-statements');
  assert.equal(st.body.realisedNetProfit, '989');
  assert.equal(st.body.commissionOutstanding, '148.35');
});

test('pause and disconnect: trading stops and the key is wiped', async () => {
  assert.equal((await call('POST', '/trading/trading/pause')).body.tradingPaused, true);
  const paused = await placeStrategyOrder(proposal({ side: 'buy', quoteAmount: '100', idempotencyKey: `sig-5-${RUN}` }), { fetchImpl: fakeFetch });
  assert.equal(paused.placed, false);
  await call('POST', '/trading/trading/resume');
  const d = await call('DELETE', `/trading/exchanges/connections/${connId}`);
  assert.equal(d.status, 200); assert.match(d.body.keySettingsUrl, /binance\.com/);
  const { rows: [row] } = await pool.query('select credentials_ciphertext, status from trading.exchange_connections where id = $1', [connId]);
  assert.deepEqual([row.credentials_ciphertext, row.status], ['revoked', 'revoked']);
});
