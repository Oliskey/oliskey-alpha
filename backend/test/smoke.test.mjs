// Smoke test against a running backend: node --test test/  (server must be on API_URL, default :3311)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const API = process.env.API_URL || 'http://localhost:3311';
const get = async (path, headers) => {
  const res = await fetch(API + path, { headers });
  return { status: res.status, headers: res.headers, body: await res.json() };
};

test('health and assets', async () => {
  const health = (await get('/health')).body;
  const { body } = await get('/assets');
  assert.equal(health.ok, true);
  assert.equal(body.length, health.assets);
  assert.ok(body.length >= 75, `full market list, got ${body.length}`);
  for (const c of ['currency', 'crypto', 'index', 'commodity']) assert.ok(body.some((a) => a.category === c), c);
  for (const a of body.filter((x) => x.price_source !== 'binance')) assert.ok(a.price > 0, `${a.id} has a price`);
});

test('live crypto prices arrive from the market feed', async (t) => {
  const live = (await get('/assets')).body.filter((a) => a.price_source === 'binance');
  assert.ok(live.length > 0, 'some assets use the live feed');
  // Same rule as inzone-zone.test.mjs: a server that cannot reach the exchange at all (a sandbox without internet)
  // reports it as skipped, never as passed. A feed that works for some coins but not others still fails.
  if (live.every((a) => !(a.price > 0))) return t.skip('the market feed is unreachable from this server');
  for (const a of live) assert.ok(a.price > 0, `${a.id} has a live price`);
});

test('price endpoint', async () => {
  const { status, body } = await get('/price/EURUSD');
  assert.equal(status, 200);
  assert.ok(body.price > 1 && body.price < 1.25 && body.ts <= Date.now());
  assert.equal((await get('/price/NOPE')).status, 404);
});

test('candles are valid OHLC, ordered, on the timeframe grid', async () => {
  for (const tf of [5, 20, 60, 600, 3600, 900, 14400, 86400]) {   // 15 min+ come from the 6-month store
    const { body } = await get(`/candles/EURUSD?tf=${tf}&count=20`);
    assert.ok(body.length >= 12 && body.length <= 20, `tf ${tf}: ${body.length} candles`);
    body.forEach((c, i) => {
      assert.ok(c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close), 'OHLC bounds');
      assert.equal(c.time % (tf * 1000), 0, 'aligned to timeframe');
      if (i) assert.equal(c.time - body[i - 1].time, tf * 1000, 'no gaps');
    });
  }
  assert.equal((await get('/candles/EURUSD?tf=7')).status, 400);
  assert.equal((await get('/candles/EURUSD?tf=4000')).status, 400);     // over 1 h but not a multiple of 15 min
  assert.equal((await get('/candles/EURUSD?tf=604800')).status, 200);   // 7-day candles
  assert.equal((await get('/candles/EURUSD?tf=2678400')).status, 400);  // over 30 days
  assert.equal((await get('/candles/EURUSD?tf=86400&count=5001')).status, 400);
  assert.equal((await get('/candles/EURUSD?tf=3600&count=5000')).body.length >= 4000, true, '6 months of hourly candles');
  assert.equal((await get('/candles/EURUSD?count=0')).status, 400);
  assert.equal((await get('/candles/NOPE')).status, 404);
});

test('order flow: price ticks for every asset, real buy/sell volume only for live crypto', async () => {
  const sim = await get('/flow/EURUSD');
  assert.equal(sim.status, 200);
  assert.equal(sim.body.live, false);
  assert.equal(sim.body.orders, null, 'no invented buyers or sellers for simulated prices');
  assert.deepEqual(sim.body.ticks.map((t) => t.label), ['Last 1m', 'Last 5 x 1m', 'Last 20 x 1m']);
  assert.deepEqual((await get('/flow/EURUSD?tf=3600')).body.ticks.map((t) => t.unit), ['5-second moves', '5-second moves', '15-minute moves']);
  assert.ok(sim.body.ticks[0].up + sim.body.ticks[0].down > 0, 'simulated price moves');
  const live = await get('/flow/BTCUSD');
  assert.equal(live.body.live, true);
  assert.deepEqual(live.body.orders.map((o) => o.label), ['Last 1m', 'Last 5 x 1m', 'Last 20 x 1m']);
  assert.match((await get('/flow/BTCUSD?tf=86400')).body.orders[2].label, /last 24 h kept/);
  for (const o of live.body.orders) assert.ok(o.buyVolume >= 0 && o.sellVolume >= 0 && o.buyTrades >= 0 && o.sellTrades >= 0);
  assert.equal((await get('/flow/NOPE')).status, 404);
});

test('volume per candle: real Binance volume for live crypto, none invented for simulated prices', async () => {
  const sim = await get('/volume/EURUSD?tf=60');
  assert.equal(sim.status, 200);
  assert.deepEqual(sim.body, { asset: 'EURUSD', live: false, bars: [] });
  const live = await get('/volume/BTCUSD?tf=60');
  assert.equal(live.body.live, true);
  for (const b of live.body.bars) {
    assert.equal(b.time % 60000, 0, 'bars start on candle boundaries');
    assert.ok(b.buy >= 0 && b.sell >= 0 && b.buy + b.sell > 0);
  }
  assert.ok(live.body.bars.every((b, i, a) => i === 0 || a[i - 1].time < b.time), 'oldest first');
  assert.equal((await get('/volume/NOPE')).status, 404);
});

test('CORS allows only configured origins', async () => {
  const ok = await get('/health', { Origin: 'http://localhost:3311' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:3311');
  const bad = await get('/health', { Origin: 'https://evil.example' });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('websocket streams ticks and momentum for subscribed assets only', async () => {
  const ws = new WebSocket(API.replace('http', 'ws') + '/stream');
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d)));

  ws.send('not json');
  ws.send(JSON.stringify({ type: 'subscribe', asset: 'NOPE' }));
  ws.send(JSON.stringify({ type: 'subscribe', asset: 'EURUSD' }));
  await new Promise((r) => setTimeout(r, 3000));
  ws.close();

  const ticks = msgs.filter((m) => m.type === 'tick');
  const momentum = msgs.filter((m) => m.type === 'momentum');
  const errors = msgs.filter((m) => m.type === 'error').map((m) => m.message);
  console.log(`  3s stream: ${ticks.length} ticks, ${momentum.length} momentum, sample`, ticks.slice(0, 3));

  assert.deepEqual(errors, ['Invalid JSON', 'Unknown asset']);
  assert.ok(ticks.length >= 10 && ticks.length <= 14, `about 4 ticks/sec, got ${ticks.length}`);
  assert.ok(momentum.length >= 2, 'momentum every second');
  assert.ok(ticks.every((t) => t.asset === 'EURUSD'), 'only subscribed asset');
  assert.ok(ticks.every((t) => Number.isInteger(Math.round(t.price * 1e5)) && t.price.toFixed(5) == t.price), '5 decimals');
  assert.ok(momentum.every((m) => m.up >= 0 && m.up <= 100));
});
