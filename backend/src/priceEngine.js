// Server-side price engine: the only source of prices in Oliskey Alpha.
// Every TICK_MS each active asset moves by a mean-reverting random walk around its base_price.
// Memory per asset: every tick for the last 30 minutes (settlement, quote history, momentum),
// 5-second OHLC candles for the last 12 hours (charts up to 1 h candles) and 15-minute candles for the last
// 6 months (charts with 15 m, 30 m, 1 h, 4 h and 1 day candles).
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BinanceFeed, FLOW_MAX_SEC, fetchKlines } from './binanceFeed.js';

export const TICK_MS = 250;
const TICK_HISTORY_MS = 30 * 60 * 1000;
const CANDLE_HISTORY_MS = 12 * 60 * 60 * 1000;
const BASE_TF_MS = 5000;                       // stored candle size; every chart timeframe is a multiple of it
const LONG_TF_MS = 15 * 60 * 1000;            // long-history candle size
const ZONE_MAX_AGE_MS = 3 * 60 * 1000;         // corridor candles older than this are not used
const QUOTE_MAX_AGE_MS = 2 * 60 * 1000;        // a live price with no trade for this long cannot open a trade
const LONG_HISTORY_MS = 183 * 24 * 60 * 60 * 1000;   // about 6 months
const COARSE_MS = 1000;                        // step size when generating history older than the tick window
const LONG_STEP_MS = 60 * 1000;                // step size when generating history older than 12 h
const REVERSION = 0.001;                       // pull back towards base_price per tick
const MOMENTUM_WINDOW = 40;
// Chart timeframes: any multiple of 5 s up to 1 h (from the 12 h store), or any multiple of 15 min up to 30 days
// (from the 6-month store).
export const isValidTimeframe = (sec) => Number.isInteger(sec)
  && ((sec >= 5 && sec <= 3600 && sec % 5 === 0) || (sec >= 900 && sec <= 30 * 86400 && sec % 900 === 0));
const usesLong = (sec) => sec >= 900 && sec % 900 === 0;
const fmtTf = (s) => (s % 86400 === 0 ? `${s / 86400}D` : s % 3600 === 0 ? `${s / 3600}h` : s % 60 === 0 ? `${s / 60}m` : `${s}s`);

// Standard normal sample (Box-Muller).
function gaussian() {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

// Fixed-size circular buffer of parallel Float64 columns, in time order (column 0 = time).
class Ring {
  constructor(size, columns) {
    this.cols = Array.from({ length: columns }, () => new Float64Array(size));
    this.size = size;
    this.start = 0;
    this.length = 0;
  }
  idx(n) { return (this.start + n) % this.size; }
  push(...values) {
    const i = (this.start + this.length) % this.size;
    for (let c = 0; c < values.length; c++) this.cols[c][i] = values[c];
    if (this.length < this.size) this.length++;
    else this.start = (this.start + 1) % this.size;
  }
  get(n, c) { return this.cols[c][this.idx(n)]; }
  set(n, c, v) { this.cols[c][this.idx(n)] = v; }
  // First index whose time is >= t (binary search).
  firstAtOrAfter(t) {
    let lo = 0, hi = this.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.get(mid, 0) < t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  // Column copies in time order (for saving).
  toArrays() {
    return this.cols.map((col) => {
      const out = new Float64Array(this.length);
      for (let n = 0; n < this.length; n++) out[n] = col[this.idx(n)];
      return out;
    });
  }
}

export class PriceEngine extends EventEmitter {
  constructor(assets) {
    super();
    this.assets = new Map();
    for (const a of assets) {
      this.assets.set(a.id, {
        id: a.id,
        base: Number(a.base_price),
        factor: 10 ** a.decimals,
        volatility: Number(a.volatility),
        feed: a.price_source === 'binance' ? a.source_symbol : null,   // live market price instead of simulation
        ticks: new Ring(TICK_HISTORY_MS / TICK_MS, 2),          // ts, price
        candles: new Ring(CANDLE_HISTORY_MS / BASE_TF_MS, 5),    // time, open, high, low, close
        long: new Ring(LONG_HISTORY_MS / LONG_TF_MS + 2, 5),     // 15-minute candles, same columns
      });
    }
    this.timer = null;
    this.live = new BinanceFeed([...this.assets.values()].filter((a) => a.feed).map((a) => a.feed));
    this.zoneCandles = new Map();   // assetId -> { closes, lastAt }: finished Binance 1-minute closes for the InZone corridor
  }

  // One random-walk step. `ticks` > 1 takes a coarser step covering that many ticks.
  step(asset, price, ticks = 1) {
    const next = price + REVERSION * ticks * (asset.base - price) + price * asset.volatility * Math.sqrt(ticks) * gaussian();
    return Math.round(next * asset.factor) / asset.factor;
  }

  // Merge a price range into the 15-minute candle that contains ts.
  recordLong(asset, ts, o, h, l, c) {
    const r = asset.long;
    const bucket = Math.floor(ts / LONG_TF_MS) * LONG_TF_MS;
    const last = r.length - 1;
    if (r.length && r.get(last, 0) === bucket) {
      if (h > r.get(last, 2)) r.set(last, 2, h);
      if (l < r.get(last, 3)) r.set(last, 3, l);
      r.set(last, 4, c);
    } else if (!r.length || bucket > r.get(last, 0)) {
      r.push(bucket, o, h, l, c);
    }
  }

  // Record a price: into the tick window (when `keepTick`), the 5 s candle and the 15 min candle.
  record(asset, ts, price, keepTick = true) {
    if (keepTick) asset.ticks.push(ts, price);
    this.recordLong(asset, ts, price, price, price, price);
    const c = asset.candles;
    const bucket = Math.floor(ts / BASE_TF_MS) * BASE_TF_MS;
    const last = c.length - 1;
    if (c.length && c.get(last, 0) === bucket) {
      if (price > c.get(last, 2)) c.set(last, 2, price);
      if (price < c.get(last, 3)) c.set(last, 3, price);
      c.set(last, 4, price);
    } else if (!c.length || bucket > c.get(last, 0)) {
      c.push(bucket, price, price, price, price);
    }
  }

  // Simulate from `from` (exclusive) to `to`: 1 min steps (15 min candles only) before the 12 h window,
  // 1 s steps inside it, 250 ms ticks in the last 30 minutes.
  generate(asset, from, to, price) {
    const tickStart = to - TICK_HISTORY_MS;
    const fineStart = to - CANDLE_HISTORY_MS;
    let ts = from;
    while (ts + LONG_STEP_MS <= fineStart) {
      ts += LONG_STEP_MS;
      const open = price;
      price = this.step(asset, price, LONG_STEP_MS / TICK_MS);
      // A 1-minute step's range: the move plus a little intrabar noise, so 15 min candles have real wicks.
      const wick = Math.abs(price * asset.volatility * Math.sqrt(LONG_STEP_MS / TICK_MS) * gaussian()) / 2;
      this.recordLong(asset, ts, open, this.round(asset, Math.max(open, price) + wick), this.round(asset, Math.min(open, price) - wick), price);
    }
    while (ts + COARSE_MS <= tickStart) {
      ts += COARSE_MS;
      price = this.step(asset, price, COARSE_MS / TICK_MS);
      this.record(asset, ts, price, false);
    }
    while (ts + TICK_MS <= to) {
      ts += TICK_MS;
      price = this.step(asset, price);
      this.record(asset, ts, price);
    }
    return price;
  }

  backfill(now = Date.now()) {
    for (const a of this.assets.values()) if (!a.feed) this.generate(a, now - LONG_HISTORY_MS, now, a.base);
  }

  // History older than `endTs` that ends exactly at `endPrice`: the walk is generated backwards from the known
  // price, then stored oldest first (used once to extend a 12 h snapshot to 6 months).
  prependLong(asset, fromTs, endTs, endPrice) {
    const steps = [];
    let price = endPrice;
    for (let ts = endTs; ts - LONG_STEP_MS >= fromTs; ts -= LONG_STEP_MS) {
      const prev = this.step(asset, price, LONG_STEP_MS / TICK_MS);
      steps.push([ts - LONG_STEP_MS, prev, price]);
      price = prev;
    }
    for (let i = steps.length - 1; i >= 0; i--) {
      const [ts, open, close] = steps[i];
      const wick = Math.abs(open * asset.volatility * Math.sqrt(LONG_STEP_MS / TICK_MS) * gaussian()) / 2;
      this.recordLong(asset, ts, open, this.round(asset, Math.max(open, close) + wick), this.round(asset, Math.min(open, close) - wick), close);
    }
  }

  // Real history for live assets from Binance: 1-minute klines for the older part of the 12 h window,
  // 1-second klines for the last hour (charts at 5 s-30 s need that detail).
  async loadLiveHistory(now = Date.now()) {
    const fineFrom = now - 60 * 60 * 1000;
    const live = [...this.assets.values()].filter((a) => a.feed);
    const loadOne = async (a) => {
      const minutes = await fetchKlines(a.feed, '1m', now - CANDLE_HISTORY_MS, fineFrom - 1);
      for (const k of minutes) this.recordCandle(a, k.t, k.o, k.h, k.l, k.c);
      const seconds = await fetchKlines(a.feed, '1s', fineFrom, now);
      for (const k of seconds) {
        for (const p of [k.o, k.h, k.l]) this.record(a, k.t, this.round(a, p), false);
        this.record(a, k.t + 999, this.round(a, k.c), k.t >= now - TICK_HISTORY_MS);
      }
    };
    // A slow connection must not leave a market without history: try the ones that failed again, before live prices start,
    // because candles are stored in time order.
    let todo = live;
    for (let round = 0; round < 3 && todo.length; round++) {
      const failed = [];
      for (let i = 0; i < todo.length; i += 4) {
        await Promise.all(todo.slice(i, i + 4).map((a) => loadOne(a).catch((err) => { failed.push(a); console.error('history', a.id, err.message); })));
      }
      todo = failed;
      if (todo.length && round < 2) await new Promise((r) => { setTimeout(r, 3000); });
    }
  }

  // 6 months of real 15-minute candles for live assets, loaded after start-up (only the part the snapshot lacks)
  // and merged into the long store. Failed assets are retried once a minute later.
  async loadLongLive(now = Date.now()) {
    const until = now - CANDLE_HISTORY_MS - 1;
    const failed = [];
    const live = [...this.assets.values()].filter((a) => a.feed);
    const loadOne = async (a) => {
      // Download from the first missing 15 m candle: either 6 months back, or the end of the unbroken run of
      // candles the snapshot already holds from that point.
      const r = a.long;
      let from = now - LONG_HISTORY_MS;
      if (r.length && r.get(0, 0) <= from + 24 * 60 * 60 * 1000) {
        let n = 0;
        while (n + 1 < r.length && r.get(n + 1, 0) - r.get(n, 0) <= LONG_TF_MS) n++;
        from = r.get(n, 0) + LONG_TF_MS;
      }
      if (from >= until) return;
      const klines = await fetchKlines(a.feed, '15m', from, until);
      this.mergeLong(a, klines.map((k) => [k.t, ...[k.o, k.h, k.l, k.c].map((v) => this.round(a, v))]));
    };
    for (let i = 0; i < live.length; i += 2) {
      await Promise.all(live.slice(i, i + 2).map((a) => loadOne(a).catch((err) => { failed.push(a.id); console.error('6-month history', a.id, err.message); })));
    }
    if (failed.length && !this.longRetried) {
      this.longRetried = true;
      setTimeout(() => this.loadLongLive().catch(() => {}), 60_000).unref();
    }
  }

  // Inserts candles anywhere in time into the 15 m store (existing candles win), keeping it in order.
  mergeLong(asset, rows) {
    if (!rows.length) return;
    const byTime = new Map(rows.map((r) => [r[0], r]));
    const r = asset.long;
    for (let n = 0; n < r.length; n++) byTime.set(r.get(n, 0), [0, 1, 2, 3, 4].map((c) => r.get(n, c)));
    const merged = [...byTime.values()].filter((x) => x[0] >= Date.now() - LONG_HISTORY_MS).sort((x, y) => x[0] - y[0]);
    const next = new Ring(r.size, 5);
    for (const x of merged.slice(-r.size)) next.push(...x);
    asset.long = next;
  }

  round(asset, price) {
    return Math.round(price * asset.factor) / asset.factor;
  }

  // A whole candle (e.g. one Binance 1-minute kline) stored in the 5 s candle ring at its start time
  // and merged into its 15-minute candle.
  recordCandle(asset, ts, o, h, l, c) {
    const cr = asset.candles;
    const bucket = Math.floor(ts / BASE_TF_MS) * BASE_TF_MS;
    if (cr.length && bucket <= cr.get(cr.length - 1, 0)) return;
    const [ro, rh, rl, rc] = [o, h, l, c].map((v) => this.round(asset, v));
    cr.push(bucket, ro, rh, rl, rc);
    this.recordLong(asset, ts, ro, rh, rl, rc);
  }

  // Simulated assets continue from a saved snapshot when there is one (so past trades still line up after a
  // restart), filling only the gap since it was saved; otherwise their history is generated.
  // Live assets always load their real history from Binance, then follow the live trade stream.
  async start(snapshotFile) {
    if (!(snapshotFile && this.restore(snapshotFile))) this.backfill();
    await this.loadLiveHistory();
    this.live.start();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.loadLongLive().catch((err) => console.error('6-month history', err.message));   // not awaited
    this.refreshZones();
    this.zoneTimer = setInterval(() => this.refreshZones(), 60_000);
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.zoneTimer);
    this.live.stop();
  }

  tick() {
    const ts = Date.now();
    for (const a of this.assets.values()) {
      const prev = a.ticks.length ? a.ticks.get(a.ticks.length - 1, 1) : null;
      let price;
      if (a.feed) {
        const q = this.live.price(a.feed);
        price = q ? this.round(a, q.price) : prev;   // no fabricated moves: hold the last real price until trades arrive
        if (price == null) continue;
      } else {
        price = this.step(a, prev);
      }
      this.record(a, ts, price);
      this.emit('tick', { asset: a.id, price, ts });
    }
  }

  // InZone corridor half-width in %, for live markets only: 0.511 x blended recent volatility x sqrt(duration). The blend (half
  // the last 15 minutes, 30% the last hour, 20% the last 4 hours) and the 0.511 were measured on real Binance data. On months
  // not used to choose them, 43-47.5% of trades finish inside at every level of market activity, so no calm or busy moment
  // beats the 47.62% that breaks even at +110%. Using one window alone left moments that did. Null with too little history.
  // It reads finished Binance candles, as the research did: the server's own candles go flat if the PC sleeps, which bends it.
  liveZonePct(assetId, durationSec, now = Date.now()) {
    const saved = this.zoneCandles.get(assetId);
    if (!saved || now - saved.lastAt > ZONE_MAX_AGE_MS) return null;
    const { closes } = saved;
    if (closes.length < 61) return null;
    const moves = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
    const variance = (n) => {
      const m = moves.slice(-n);
      const mean = m.reduce((s, v) => s + v, 0) / m.length;
      return m.reduce((s, v) => s + (v - mean) ** 2, 0) / (m.length - 1);
    };
    const perMinute = Math.sqrt(0.5 * variance(15) + 0.3 * variance(60) + 0.2 * variance(240));
    return perMinute > 0 ? Math.round(0.511 * perMinute * Math.sqrt(durationSec / 60) * 100 * 1e6) / 1e6 : null;
  }

  async refreshZones(now = Date.now()) {
    const live = [...this.assets.values()].filter((a) => a.feed);
    for (let i = 0; i < live.length; i += 4) {
      await Promise.all(live.slice(i, i + 4).map(async (a) => {
        try {
          const finished = (await fetchKlines(a.feed, '1m', now - 243 * 60_000, now)).filter((k) => k.t + 60_000 <= now).slice(-241);
          if (finished.length) this.zoneCandles.set(a.id, { closes: finished.map((k) => k.c), lastAt: finished[finished.length - 1].t + 60_000 });
        } catch (err) {
          console.error('corridor candles', a.id, err.message);   // too old soon means no corridor, so no InZone trade on this market
        }
      }));
    }
  }

  isLive(assetId) {
    return !!this.assets.get(assetId)?.feed;
  }

  // False when a live market has had no real trade for a while: its price cannot be trusted for opening a trade.
  isFresh(assetId, now = Date.now()) {
    const a = this.assets.get(assetId);
    if (!a?.feed) return !!a;
    const q = this.live.price(a.feed);
    return !!q && now - q.ts <= QUOTE_MAX_AGE_MS;
  }

  // The real price at a past moment, from Binance, for a trade whose end this server did not see (it was asleep or off).
  async sourcePriceAt(assetId, ts) {
    const a = this.assets.get(assetId);
    const rows = await fetchKlines(a.feed, '1s', ts - 60_000, ts - 1);
    const last = rows.length ? rows : await fetchKlines(a.feed, '1m', ts - 300_000, ts - 1);
    if (!last.length) return null;
    const k = last[last.length - 1];
    return { ts: k.t, price: this.round(a, k.c) };
  }

  // Snapshot file: [u32 header length][JSON header, padded to 8 bytes][raw Float64 columns].
  save(file) {
    const header = { version: 3, assets: [] };
    const blocks = [];
    for (const a of this.assets.values()) {
      // Live assets keep only their 15 m store (the recent 12 h reloads from Binance on start).
      const [ts, price] = a.feed ? [new Float64Array(0), new Float64Array(0)] : a.ticks.toArrays();
      const candleCols = a.feed ? [0, 1, 2, 3, 4].map(() => new Float64Array(0)) : a.candles.toArrays();
      const longCols = a.long.toArrays();
      header.assets.push({ id: a.id, ticks: ts.length, candles: candleCols[0].length, long: longCols[0].length });
      blocks.push(ts, price, ...candleCols, ...longCols);
    }
    let json = Buffer.from(JSON.stringify(header));
    const pad = (8 - ((4 + json.length) % 8)) % 8;
    json = Buffer.concat([json, Buffer.alloc(pad, 0x20)]);
    const len = Buffer.alloc(4);
    len.writeUInt32LE(json.length);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, Buffer.concat([len, json, ...blocks.map((b) => Buffer.from(b.buffer, b.byteOffset, b.byteLength))]));
    renameSync(`${file}.tmp`, file);
  }

  restore(file, now = Date.now()) {
    if (!existsSync(file)) return false;
    let header, buf, offset;
    try {
      buf = readFileSync(file);
      const len = buf.readUInt32LE(0);
      header = JSON.parse(buf.subarray(4, 4 + len).toString());
      offset = 4 + len;
    } catch {
      return false;
    }
    if (header.version !== 2 && header.version !== 3) return false;
    const read = (n) => {
      const out = new Float64Array(buf.buffer.slice(buf.byteOffset + offset, buf.byteOffset + offset + n * 8));
      offset += n * 8;
      return out;
    };
    const saved = new Map();
    for (const h of header.assets) {
      saved.set(h.id, {
        ts: read(h.ticks), price: read(h.ticks), candles: [0, 1, 2, 3, 4].map(() => read(h.candles)),
        long: [0, 1, 2, 3, 4].map(() => read(h.long ?? 0)),   // version 2 files have no 6-month history
      });
    }

    const candleFrom = now - CANDLE_HISTORY_MS;
    for (const a of this.assets.values()) {
      const s = saved.get(a.id);
      if (a.feed) {
        // Real 15 m history older than the 12 h window; the rest reloads from Binance.
        const [lt, lo, lh, ll, lc] = s?.long ?? [];
        for (let n = 0; n < (lt?.length ?? 0); n++) {
          if (lt[n] >= now - LONG_HISTORY_MS && lt[n] < now - CANDLE_HISTORY_MS - LONG_TF_MS) a.long.push(lt[n], lo[n], lh[n], ll[n], lc[n]);
        }
        continue;
      }
      if (!s || !s.ts.length) { this.generate(a, now - LONG_HISTORY_MS, now, a.base); continue; }
      const [ct, co, ch, cl, cc] = s.candles;
      const [lt, lo, lh, ll, lc] = s.long;
      const longFrom = now - LONG_HISTORY_MS;
      if (lt.length) {
        for (let n = 0; n < lt.length; n++) if (lt[n] >= longFrom && lt[n] <= now) a.long.push(lt[n], lo[n], lh[n], ll[n], lc[n]);
      } else if (ct.length) {
        this.prependLong(a, longFrom, ct[0], co[0]);   // extend an old 12 h snapshot back to 6 months
      }
      for (let n = 0; n < ct.length; n++) {
        if (ct[n] < candleFrom || ct[n] > now) continue;
        a.candles.push(ct[n], co[n], ch[n], cl[n], cc[n]);
        if (!lt.length) this.recordLong(a, ct[n], co[n], ch[n], cl[n], cc[n]);
      }
      for (let n = 0; n < s.ts.length; n++) if (s.ts[n] >= now - TICK_HISTORY_MS && s.ts[n] <= now) a.ticks.push(s.ts[n], s.price[n]);
      const lastTs = s.ts[s.ts.length - 1];
      const lastPrice = s.price[s.price.length - 1];
      this.generate(a, Math.max(lastTs, now - LONG_HISTORY_MS), now, lastPrice);   // also fills a long outage
    }
    return true;
  }

  has(assetId) {
    return this.assets.has(assetId);
  }

  getPrice(assetId) {
    const t = this.assets.get(assetId)?.ticks;
    if (!t?.length) return null;
    return { ts: t.get(t.length - 1, 0), price: t.get(t.length - 1, 1) };
  }

  // Last tick at or before ts (the quote in force at that moment); falls back to the latest price.
  getPriceAt(assetId, ts) {
    const t = this.assets.get(assetId)?.ticks;
    if (!t?.length) return null;
    const n = t.firstAtOrAfter(ts + 1) - 1;
    return n >= 0 ? { ts: t.get(n, 0), price: t.get(n, 1) } : this.getPrice(assetId);
  }

  // Ticks between from and to (only the last 30 minutes are kept tick by tick).
  getTicks(assetId, from, to) {
    const t = this.assets.get(assetId)?.ticks;
    if (!t) return [];
    const out = [];
    for (let n = t.firstAtOrAfter(from); n < t.length; n++) {
      const ts = t.get(n, 0);
      if (ts > to) break;
      out.push({ ts, price: t.get(n, 1) });
    }
    return out;
  }

  // OHLC candles for a timeframe, oldest first. The last candle is the one still forming.
  getCandles(assetId, timeframeSec, count) {
    const a = this.assets.get(assetId);
    const c = usesLong(timeframeSec) ? a?.long : a?.candles;
    if (!c?.length) return [];
    const tfMs = timeframeSec * 1000;
    const lastBucket = Math.floor(c.get(c.length - 1, 0) / tfMs) * tfMs;
    const out = [];
    let cur = null;
    for (let n = c.firstAtOrAfter(lastBucket - (count - 1) * tfMs); n < c.length; n++) {
      const bucket = Math.floor(c.get(n, 0) / tfMs) * tfMs;
      // Quiet periods with no trades (live markets) become flat candles at the last close, like other charting tools.
      while (cur && cur.time + tfMs < bucket) {
        cur = { time: cur.time + tfMs, open: cur.close, high: cur.close, low: cur.close, close: cur.close };
        out.push(cur);
      }
      if (!cur || cur.time !== bucket) {
        cur = { time: bucket, open: c.get(n, 1), high: c.get(n, 2), low: c.get(n, 3), close: c.get(n, 4) };
        out.push(cur);
      } else {
        if (c.get(n, 2) > cur.high) cur.high = c.get(n, 2);
        if (c.get(n, 3) < cur.low) cur.low = c.get(n, 3);
        cur.close = c.get(n, 4);
      }
    }
    return out.slice(-count);
  }

  // Details behind the momentum bar, for the last 1, 5 and 20 candles of the chart's timeframe.
  // Every asset: price moves up vs down (ticks up to 30 min, 5 s moves up to 12 h, 15 min moves beyond).
  // Live (Binance) assets also get real buyer- vs seller-initiated volume (kept 24 h); simulated assets have no
  // buyers or sellers, so none is invented.
  // Real buy/sell volume per candle (live Binance assets only, last 24 h). Simulated assets have no volume.
  getVolume(assetId, tfSec = 60, now = Date.now()) {
    const a = this.assets.get(assetId);
    if (!a) return null;
    return { asset: assetId, live: !!a.feed, bars: a.feed ? this.live.series(a.feed, tfSec, now) : [] };
  }

  getFlow(assetId, tfSec = 60, now = Date.now()) {
    const a = this.assets.get(assetId);
    if (!a) return null;
    const moves = (sec) => {
      const from = now - sec * 1000;
      let up = 0, down = 0, prev = null;
      const count = (p) => { if (prev !== null) { if (p > prev) up++; else if (p < prev) down++; } prev = p; };
      if (sec <= TICK_HISTORY_MS / 1000) {
        for (const t of this.getTicks(assetId, from, now)) count(t.price);
        return { up, down, unit: 'ticks' };
      }
      const ring = sec <= CANDLE_HISTORY_MS / 1000 ? a.candles : a.long;
      for (let n = ring.firstAtOrAfter(from); n < ring.length; n++) count(ring.get(n, 4));
      return { up, down, unit: ring === a.candles ? '5-second moves' : '15-minute moves' };
    };
    const windows = [1, 5, 20].map((k) => ({ sec: tfSec * k, label: `Last ${k === 1 ? '' : k + ' x '}${fmtTf(tfSec)}` }));
    return {
      asset: assetId,
      live: !!a.feed,
      timeframe: fmtTf(tfSec),
      ticks: windows.map((w) => ({ label: w.label, ...moves(w.sec) })),
      orders: a.feed ? windows.map((w) => ({
        label: w.sec > FLOW_MAX_SEC ? `${w.label} (last 24 h kept)` : w.label, ...this.live.flow(a.feed, w.sec, now),
      })) : null,
    };
  }

  // Share of upticks over the last MOMENTUM_WINDOW ticks, 0-100. Shown in the UI as "momentum".
  getMomentum(assetId) {
    const t = this.assets.get(assetId)?.ticks;
    if (!t || t.length < 2) return 50;
    let up = 0, moves = 0;
    for (let n = Math.max(1, t.length - MOMENTUM_WINDOW); n < t.length; n++) {
      const diff = t.get(n, 1) - t.get(n - 1, 1);
      if (diff !== 0) { moves++; if (diff > 0) up++; }
    }
    return moves ? Math.round((up / moves) * 100) : 50;
  }
}
