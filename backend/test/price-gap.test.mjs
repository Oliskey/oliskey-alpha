// When the server was asleep or off: no old price may open a trade, close a trade, or bend the InZone corridor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BinanceFeed } from '../src/binanceFeed.js';
import { PriceEngine } from '../src/priceEngine.js';
import { Settlement } from '../src/settlement.js';

const engineWith = (feed = 'BTCUSDT') => {
  const e = Object.create(PriceEngine.prototype);
  e.assets = new Map([['BTCUSD', { id: 'BTCUSD', feed }], ['EURUSD', { id: 'EURUSD' }]]);
  e.live = new BinanceFeed([feed]);
  e.zoneCandles = new Map();
  return e;
};

test('a live price with no recent trade is not fresh; a simulated market always is', () => {
  const e = engineWith();
  const now = 1_000_000_000;
  assert.equal(e.isFresh('BTCUSD', now), false, 'no price yet');
  e.live.last.set('BTCUSDT', { price: 1, ts: now - 1000 });
  assert.equal(e.isFresh('BTCUSD', now), true);
  e.live.last.set('BTCUSDT', { price: 1, ts: now - 121_000 });
  assert.equal(e.isFresh('BTCUSD', now), false, 'two minutes old');
  assert.equal(e.isFresh('EURUSD', now), true);
  assert.equal(e.isFresh('NOPE', now), false);
});

test('the corridor is unavailable when its real candles are too old, and matches the formula when they are not', () => {
  const e = engineWith();
  const now = 1_000_000_000;
  assert.equal(e.liveZonePct('BTCUSD', 3600, now), null, 'none loaded');
  const closes = Array.from({ length: 241 }, (_, i) => 100 * Math.exp(0.001 * (i % 2)));
  e.zoneCandles.set('BTCUSD', { closes, lastAt: now - 60_000 });
  const zone = e.liveZonePct('BTCUSD', 3600, now);
  const moves = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  const v = (n) => { const m = moves.slice(-n); const a = m.reduce((s, x) => s + x, 0) / n; return m.reduce((s, x) => s + (x - a) ** 2, 0) / (n - 1); };
  const want = 0.511 * Math.sqrt(0.5 * v(15) + 0.3 * v(60) + 0.2 * v(240)) * Math.sqrt(60) * 100;
  assert.ok(Math.abs(zone - want) < 1e-5, `${zone} vs ${want}`);
  e.zoneCandles.set('BTCUSD', { closes, lastAt: now - 181_000 });
  assert.equal(e.liveZonePct('BTCUSD', 3600, now), null, 'too old');
});

test('a silent connection is dropped so it can reconnect; a talking one is left alone', () => {
  const feed = new BinanceFeed(['BTCUSDT']);
  let dropped = 0;
  feed.ws = { terminate: () => { dropped++; } };
  feed.heardAt = 1_000_000;
  feed.checkSilence(1_000_000 + 29_000);
  assert.equal(dropped, 0);
  feed.checkSilence(1_000_000 + 31_000);
  assert.equal(dropped, 1);
  feed.checkSilence(1_000_000 + 60_000);
  assert.equal(dropped, 1, 'once per connection');
});

const settlementFor = (engine) => {
  const s = new Settlement(engine, () => {});
  s.settled = [];
  s.settle = async (trade, tick) => { s.settled.push({ id: trade.id, tick }); s.open.delete(trade.id); };
  return s;
};
const flush = () => new Promise((r) => { setImmediate(r); });

test('a trade that ended while the server slept closes at the real market price, not the old one', async () => {
  const ends = Date.now() - 3_600_000;
  const asked = [];
  const engine = { isLive: () => true, getPriceAt: () => ({ ts: ends - 3_000_000, price: 100 }),
    sourcePriceAt: async (asset, ts) => { asked.push([asset, ts]); return { ts, price: 90 }; } };
  const s = settlementFor(engine);
  s.add({ id: 't1', mode: 'inzone', asset_id: 'BTCUSD', expires_at: new Date(ends).toISOString() });
  s.loop();
  await flush();
  assert.deepEqual(asked, [['BTCUSD', ends]]);
  assert.equal(s.settled[0].tick.price, 90);
});

test('it waits and retries while the market price cannot be read; it never settles on the old price', async () => {
  const ends = Date.now() - 3_600_000;
  let calls = 0;
  const engine = { isLive: () => true, getPriceAt: () => ({ ts: ends - 3_000_000, price: 100 }),
    sourcePriceAt: async () => { calls++; throw new Error('offline'); } };
  const s = settlementFor(engine);
  const log = console.error; console.error = () => {};
  s.add({ id: 't1', mode: 'fixed_time', asset_id: 'BTCUSD', expires_at: new Date(ends).toISOString() });
  s.loop();
  await flush();
  s.loop();   // too soon to try again
  await flush();
  console.error = log;
  assert.equal(calls, 1);
  assert.equal(s.settled.length, 0);
  assert.equal(s.open.get('t1').settling, false);
});

test('a normal close uses the price at the end; a simulated market never asks the source', async () => {
  const ends = Date.now() - 100;
  for (const live of [true, false]) {
    const engine = { isLive: () => live, getPriceAt: () => ({ ts: ends - 200, price: 50 }), sourcePriceAt: async () => assert.fail('must not be called') };
    const s = settlementFor(engine);
    s.add({ id: 't1', mode: 'inzone', asset_id: 'X', expires_at: new Date(ends).toISOString() });
    s.loop();
    await flush();
    assert.equal(s.settled[0].tick.price, 50);
  }
  const stale = { isLive: () => false, getPriceAt: () => ({ ts: ends - 3_000_000, price: 7 }), sourcePriceAt: async () => assert.fail('must not be called') };
  const s = settlementFor(stale);
  s.add({ id: 't2', mode: 'inzone', asset_id: 'EURUSD', expires_at: new Date(ends).toISOString() });
  s.loop();
  await flush();
  assert.equal(s.settled[0].tick.price, 7);
});
