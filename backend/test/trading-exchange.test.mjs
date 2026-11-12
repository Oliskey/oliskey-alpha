// Oliskey AI Trading: credential vault, Binance adapter (against recorded exchange answers; no network), paper exchange
// and the deterministic risk engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { seal, open, keyHint, reencrypt } from '../src/trading/vault.js';
import { BinanceAdapter } from '../src/trading/exchanges/binance.js';
import { PaperAdapter } from '../src/trading/exchanges/paper.js';
import { checkOrder, checkAllocations } from '../src/trading/risk.js';

const k1 = randomBytes(32).toString('base64'), k2 = randomBytes(32).toString('base64');
const env = { TRADING_CREDENTIALS_KEYS: `k1:${k1}`, TRADING_CREDENTIALS_ACTIVE: 'k1' };
const owner = { userId: 'u1', providerId: 'binance', environment: 'live' };

test('vault: encrypts, binds to the owner, rotates', () => {
  const row = seal({ apiKey: 'AKEY1234', apiSecret: 'S3CRET' }, owner, env);
  assert.ok(!row.ciphertext.includes('S3CRET') && !row.ciphertext.includes('AKEY1234'));
  assert.deepEqual(open(row, owner, env), { apiKey: 'AKEY1234', apiSecret: 'S3CRET', passphrase: undefined });
  assert.throws(() => open(row, { ...owner, userId: 'u2' }, env));            // moved to another customer
  const parts = row.ciphertext.split('.'); parts[3] = Buffer.from('tampered').toString('base64');
  assert.throws(() => open({ ...row, ciphertext: parts.join('.') }, owner, env));
  const env2 = { TRADING_CREDENTIALS_KEYS: `k1:${k1},k2:${k2}`, TRADING_CREDENTIALS_ACTIVE: 'k2' };
  const rotated = reencrypt(row, owner, env2);
  assert.equal(rotated.keyId, 'k2');
  assert.equal(open(rotated, owner, env2).apiSecret, 'S3CRET');
  assert.equal(keyHint('AKEY1234'), '…1234');
  assert.throws(() => seal({ apiKey: 'a', apiSecret: 'b' }, owner, {}), /VAULT_NOT_CONFIGURED|malformed/);
});

// A fake Binance that answers like the real API and records every request.
function fakeBinance(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url); calls.push({ method: init.method, path: u.pathname, params: Object.fromEntries(u.searchParams), headers: init.headers });
    const h = routes[`${init.method} ${u.pathname}`];
    if (!h) throw new Error(`unexpected ${init.method} ${u.pathname}`);
    const r = typeof h === 'function' ? await h(u, calls.length) : h;
    if (r instanceof Error) throw r;
    return { status: r.status ?? 200, headers: new Map(Object.entries(r.headers || {})), text: async () => JSON.stringify(r.body) };
  };
  return { fetchImpl, calls };
}
const creds = { apiKey: 'test-key', apiSecret: 'test-secret' };
const NOW = 1_763_000_000_000;

test('binance: signs requests correctly and never sends the secret', async () => {
  const { fetchImpl, calls } = fakeBinance({ 'GET /api/v3/account': { body: { canTrade: true, permissions: ['SPOT'], balances: [{ asset: 'USDT', free: '100.5', locked: '0' }] } } });
  const b = new BinanceAdapter({ environment: 'testnet', credentials: creds, fetchImpl, now: () => NOW });
  assert.deepEqual(await b.balances(), [{ asset: 'USDT', free: '100.5', locked: '0' }]);
  const c = calls[0];
  assert.equal(c.headers['X-MBX-APIKEY'], 'test-key');
  const q = new URLSearchParams(c.params); const sig = q.get('signature'); q.delete('signature');
  assert.equal(sig, createHmac('sha256', 'test-secret').update(q.toString()).digest('hex'));
  assert.ok(!JSON.stringify(c).includes('test-secret'));
});

test('binance: refuses keys that can withdraw or transfer; warns without IP restriction', async () => {
  const base = { 'GET /api/v3/account': { body: { canTrade: true, permissions: ['SPOT'], balances: [] } } };
  const bad = fakeBinance({ ...base, 'GET /sapi/v1/account/apiRestrictions': { body: { enableReading: true, enableSpotAndMarginTrading: true, enableWithdrawals: true, enableInternalTransfer: false, permitsUniversalTransfer: true, ipRestrict: false } } });
  const r = await new BinanceAdapter({ environment: 'live', credentials: creds, fetchImpl: bad.fetchImpl, now: () => NOW }).verifyPermissions();
  assert.equal(r.ok, false); assert.deepEqual(r.forbidden, ['withdrawals', 'universal_transfer']); assert.deepEqual(r.warnings, ['ip_not_restricted']);
  const good = fakeBinance({ ...base, 'GET /sapi/v1/account/apiRestrictions': { body: { enableReading: true, enableSpotAndMarginTrading: true, ipRestrict: true } } });
  assert.equal((await new BinanceAdapter({ environment: 'live', credentials: creds, fetchImpl: good.fetchImpl, now: () => NOW }).verifyPermissions()).ok, true);
  const readOnly = fakeBinance({ ...base, 'GET /sapi/v1/account/apiRestrictions': { body: { enableReading: true, enableSpotAndMarginTrading: false, ipRestrict: true } } });
  const ro = await new BinanceAdapter({ environment: 'live', credentials: creds, fetchImpl: readOnly.fetchImpl, now: () => NOW }).verifyPermissions();
  assert.equal(ro.ok, false); assert.equal(ro.canTradeSpot, false);
});

test('binance: errors are mapped; rate limits stop with Retry-After', async () => {
  const { fetchImpl } = fakeBinance({
    'GET /api/v3/account': { status: 401, body: { code: -2015, msg: 'Invalid API-key, IP, or permissions for action.' } },
    'GET /api/v3/ticker/price': { status: 429, headers: { 'retry-after': '7' }, body: { code: -1003, msg: 'Too many requests' } },
  });
  const b = new BinanceAdapter({ environment: 'testnet', credentials: creds, fetchImpl, now: () => NOW });
  await assert.rejects(b.balances(), (e) => e.code === 'INVALID_KEY');
  await assert.rejects(b.price('BTCUSDT'), (e) => e.code === 'RATE_LIMITED' && e.retryAfterMs === 7000);
  await assert.rejects(b.price('DOGEUSDT'), (e) => e.code === 'UNSUPPORTED');
});

test('binance: a lost order answer is looked up by client id, never sent twice', async () => {
  let posts = 0;
  const { fetchImpl, calls } = fakeBinance({
    'POST /api/v3/order': () => { posts++; return new TypeError('fetch failed'); },
    'GET /api/v3/order': { body: { symbol: 'BTCUSDT', orderId: 42, clientOrderId: 'oat-abc', side: 'BUY', type: 'MARKET', status: 'FILLED', executedQty: '0.001', cummulativeQuoteQty: '50' } },
  });
  const b = new BinanceAdapter({ environment: 'testnet', credentials: creds, fetchImpl, now: () => NOW });
  const o = await b.placeOrder({ symbol: 'BTCUSDT', side: 'buy', quoteQuantity: '50', clientOrderId: 'oat-abc' });
  assert.equal(posts, 1);
  assert.equal(o.status, 'filled'); assert.equal(o.exchangeOrderId, '42');
  assert.equal(calls[1].params.origClientOrderId, 'oat-abc');
  assert.equal(calls[0].params.newClientOrderId, 'oat-abc');
});

test('binance: order not received is reported as not placed; unknown state is never guessed', async () => {
  const notThere = fakeBinance({
    'POST /api/v3/order': () => new TypeError('fetch failed'),
    'GET /api/v3/order': { status: 400, body: { code: -2013, msg: 'Order does not exist.' } },
  });
  const o = await new BinanceAdapter({ environment: 'testnet', credentials: creds, fetchImpl: notThere.fetchImpl, now: () => NOW }).placeOrder({ symbol: 'ETHUSDT', side: 'buy', quoteQuantity: '20', clientOrderId: 'oat-x' });
  assert.equal(o.status, 'rejected');
  const down = fakeBinance({ 'POST /api/v3/order': () => new TypeError('fetch failed'), 'GET /api/v3/order': () => new TypeError('fetch failed') });
  await assert.rejects(new BinanceAdapter({ environment: 'testnet', credentials: creds, fetchImpl: down.fetchImpl, now: () => NOW })
    .placeOrder({ symbol: 'ETHUSDT', side: 'buy', quoteQuantity: '20', clientOrderId: 'oat-y' }), (e) => e.code === 'UNKNOWN_ORDER_STATE');
});

test('binance: exchange rules (lot, tick, minimum value) are read from exchangeInfo', async () => {
  const { fetchImpl } = fakeBinance({ 'GET /api/v3/exchangeInfo': { body: { symbols: [{ symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING', filters: [
    { filterType: 'PRICE_FILTER', tickSize: '0.01' }, { filterType: 'LOT_SIZE', stepSize: '0.00001', minQty: '0.00001' }, { filterType: 'NOTIONAL', minNotional: '5.00' }] }] } } });
  const [s] = await new BinanceAdapter({ environment: 'testnet', fetchImpl, now: () => NOW }).symbols();
  assert.deepEqual(s.filters, { stepSize: '0.00001', minQty: '0.00001', marketStepSize: '0.00001', tickSize: '0.01', minNotional: '5.00' });
});

test('paper exchange: real prices only, same id gives the same order, cannot oversell', async () => {
  assert.throws(() => new PaperAdapter({}), /real price source/);
  const p = new PaperAdapter({ priceSource: async () => ({ price: '50000', time: NOW }), startingUsdt: '1000' });
  const a = await p.placeOrder({ symbol: 'BTCUSDT', side: 'buy', quoteQuantity: '100', clientOrderId: 'c1' });
  const again = await p.placeOrder({ symbol: 'BTCUSDT', side: 'buy', quoteQuantity: '100', clientOrderId: 'c1' });
  assert.equal(a, again);
  assert.equal(a.executedQty, '0.00199');                 // 100 / 50,025 floored to 0.00001
  await assert.rejects(p.placeOrder({ symbol: 'BTCUSDT', side: 'sell', quantity: '1', clientOrderId: 'c2' }), (e) => e.code === 'INSUFFICIENT_FUNDS');
});

const limits = { maxOrderQuote: '1000', maxPositionQuote: '5000', maxDailyLossQuote: '250', maxExposurePct: '80', maxConcurrentPositions: 4, maxSlippageBps: 30, maxPriceAgeMs: 5000 };
const ctx = (over = {}) => ({
  now: NOW, environment: 'testnet', controls: { platformPaused: false, emergencyStop: false, liveEnabled: false }, exchangeLive: false,
  userPaused: false, subscriptionActive: true, strategyApproved: true, limits, allocation: '2000', strategyExposure: '0', totalExposure: '0',
  equity: '5000', availableQuote: '5000', holding: '0', openPositions: 0, dailyRealisedLoss: '0',
  livePrice: { price: '50000', time: NOW - 1000 }, filters: { stepSize: '0.00001', minQty: '0.00001', minNotional: '5' },
  knownIdempotencyKeys: new Set(), ...over,
});
const buyP = (over = {}) => ({ userId: 'u', strategyId: 'strict_swing', symbol: 'BTCUSDT', side: 'buy', quoteAmount: '500', refPrice: '50000', priceTime: NOW - 2000, idempotencyKey: 'k1', ...over });
const failed = (r) => r.rules.filter((x) => !x.ok).map((x) => x.rule);

test('risk: a sound order passes and is sized to the lot step', () => {
  const r = checkOrder(buyP(), ctx());
  assert.equal(r.approved, true, JSON.stringify(failed(r)));
  assert.equal(r.order.quantity, '0.01');
});

test('risk: every unsafe condition is refused, whatever the AI says', () => {
  const cases = [
    [buyP(), ctx({ controls: { emergencyStop: true } }), 'emergency_stop'],
    [buyP(), ctx({ controls: { platformPaused: true } }), 'platform_pause'],
    [buyP(), ctx({ userPaused: true }), 'customer_pause'],
    [buyP(), ctx({ environment: 'live' }), 'live_enabled'],
    [buyP(), ctx({ subscriptionActive: false }), 'subscription'],
    [buyP(), ctx({ strategyApproved: false }), 'strategy_version'],
    [buyP(), ctx({ knownIdempotencyKeys: new Set(['k1']) }), 'duplicate'],
    [buyP(), ctx({ rateLimitedUntil: NOW + 5000 }), 'rate_limit'],
    [buyP(), ctx({ livePrice: { price: '50000', time: NOW - 60_000 } }), 'fresh_price'],
    [buyP(), ctx({ livePrice: { price: '50500', time: NOW } }), 'slippage'],            // +100 bps against a buy
    [buyP({ quoteAmount: '1500' }), ctx(), 'max_order'],
    [buyP(), ctx({ availableQuote: '400' }), 'balance'],
    [buyP(), ctx({ strategyExposure: '1800' }), 'strategy_allocation'],
    [buyP(), ctx({ totalExposure: '3700' }), 'max_exposure'],
    [buyP(), ctx({ openPositions: 4 }), 'max_positions'],
    [buyP(), ctx({ dailyRealisedLoss: '300' }), 'daily_loss'],
    [buyP({ quoteAmount: '3' }), ctx(), 'min_notional'],
    [buyP({ symbol: 'DOGEUSDT' }), ctx(), 'symbol'],
    [buyP({ side: 'sell', quantity: '0.1' }), ctx({ holding: '0' }), 'holding'],
  ];
  for (const [p, c, expected] of cases) {
    const r = checkOrder(p, c);
    assert.equal(r.approved, false, `${expected} should refuse`);
    assert.ok(failed(r).includes(expected), `${expected}: failed ${failed(r)}`);
  }
});

test('risk: selling what is held is allowed even after the daily loss limit (exits stay open)', () => {
  const r = checkOrder(buyP({ side: 'sell', quantity: '0.01' }), ctx({ holding: '0.01', dailyRealisedLoss: '300', strategyExposure: '500' }));
  assert.equal(r.approved, true, JSON.stringify(failed(r)));
});

test('allocations can never exceed capital', () => {
  assert.equal(checkAllocations([{ amount: '600' }, { amount: '400' }], '1000').ok, true);
  assert.equal(checkAllocations([{ amount: '600' }, { amount: '400.01' }], '1000').ok, false);
});
