// Live crypto prices from Binance spot: a public WebSocket of aggregated trades (no key needed) plus REST klines
// for history. The latest trade price per symbol is kept (the price engine samples it every tick), plus per-second
// buy/sell totals (10-second buckets) for the last 24 hours: who started each trade is real market order flow.
import WebSocket from 'ws';

const REST = 'https://api.binance.com';
const STREAM = 'wss://stream.binance.com:443/stream?streams=';
const SILENCE_MS = 30_000;
const FLOW_BUCKET_SEC = 10;
const FLOW_BUCKETS = 8640;   // 10 s x 8640 = 24 hours of order flow per symbol
export const FLOW_MAX_SEC = FLOW_BUCKET_SEC * FLOW_BUCKETS;

export class BinanceFeed {
  constructor(symbols) {
    this.symbols = symbols;
    this.last = new Map();   // symbol -> { price, ts }
    this.flows = new Map();  // symbol -> 10-second buckets for the last 24 hours
    this.retry = 0;
    this.ws = null;
    this.closed = false;
    this.heardAt = 0;
    this.watchdog = null;
  }

  // A socket can die without closing (the PC slept, the network dropped). Silence from every market means reconnect.
  checkSilence(now = Date.now()) {
    if (this.ws && this.heardAt && now - this.heardAt > SILENCE_MS) {
      this.heardAt = 0;
      this.ws.terminate();
    }
  }

  start() {
    if (!this.symbols.length) return;
    this.watchdog ??= setInterval(() => this.checkSilence(), 5000);
    const ws = new WebSocket(STREAM + this.symbols.map((s) => `${s.toLowerCase()}@aggTrade`).join('/'));
    this.ws = ws;
    this.heardAt = Date.now();
    ws.on('open', () => { this.retry = 0; });
    ws.on('message', (raw) => {
      this.heardAt = Date.now();
      const d = JSON.parse(raw).data;
      if (d?.s && d.p) {
        this.last.set(d.s, { price: Number(d.p), ts: d.T });
        this.addFlow(d.s, d.T, Number(d.p) * Number(d.q), d.m);
      }
    });
    ws.on('error', (err) => console.error('binance stream', err.message));
    ws.on('close', () => {
      if (this.closed) return;
      setTimeout(() => this.start(), Math.min(1000 * 2 ** this.retry++, 30_000));
    });
  }

  stop() {
    this.closed = true;
    clearInterval(this.watchdog);
    this.ws?.close();
  }

  price(symbol) {
    return this.last.get(symbol) ?? null;
  }

  // m = buyer is the maker, so the seller started the trade (a market sell); otherwise a market buy.
  addFlow(symbol, ts, quoteVolume, buyerIsMaker) {
    let f = this.flows.get(symbol);
    if (!f) {
      f = { stamp: new Float64Array(FLOW_BUCKETS), buyVol: new Float64Array(FLOW_BUCKETS), sellVol: new Float64Array(FLOW_BUCKETS),
            buyN: new Float64Array(FLOW_BUCKETS), sellN: new Float64Array(FLOW_BUCKETS) };
      this.flows.set(symbol, f);
    }
    const b = Math.floor(ts / 1000 / FLOW_BUCKET_SEC);
    const i = b % FLOW_BUCKETS;
    if (f.stamp[i] !== b) { f.stamp[i] = b; f.buyVol[i] = f.sellVol[i] = f.buyN[i] = f.sellN[i] = 0; }
    if (buyerIsMaker) { f.sellVol[i] += quoteVolume; f.sellN[i]++; } else { f.buyVol[i] += quoteVolume; f.buyN[i]++; }
  }

  // Buy/sell volume (quote currency, e.g. USDT) and trade counts over the last `seconds` (at most 24 h).
  flow(symbol, seconds, now = Date.now()) {
    const f = this.flows.get(symbol);
    const out = { buyVolume: 0, sellVolume: 0, buyTrades: 0, sellTrades: 0 };
    if (!f) return out;
    const from = Math.floor((now / 1000 - Math.min(seconds, FLOW_MAX_SEC)) / FLOW_BUCKET_SEC) + 1;
    for (let i = 0; i < FLOW_BUCKETS; i++) {
      if (f.stamp[i] < from) continue;
      out.buyVolume += f.buyVol[i]; out.sellVolume += f.sellVol[i]; out.buyTrades += f.buyN[i]; out.sellTrades += f.sellN[i];
    }
    return out;
  }

  // Buy/sell volume per candle of `tfSec` seconds over the kept 24 hours, oldest first: [{ time, buy, sell }].
  // Candles with no trades are left out.
  series(symbol, tfSec, now = Date.now()) {
    const f = this.flows.get(symbol);
    if (!f) return [];
    const from = Math.floor((now / 1000 - FLOW_MAX_SEC) / FLOW_BUCKET_SEC) + 1;
    const bars = new Map();
    for (let i = 0; i < FLOW_BUCKETS; i++) {
      if (f.stamp[i] < from || !(f.buyVol[i] || f.sellVol[i])) continue;
      const time = Math.floor((f.stamp[i] * FLOW_BUCKET_SEC) / tfSec) * tfSec * 1000;
      const bar = bars.get(time) ?? { time, buy: 0, sell: 0 };
      bar.buy += f.buyVol[i]; bar.sell += f.sellVol[i];
      bars.set(time, bar);
    }
    return [...bars.values()].sort((x, y) => x.time - y.time);
  }
}

// Klines between startTime and endTime (ms), oldest first: [{ t, o, h, l, c }].
export async function fetchKlines(symbol, interval, startTime, endTime) {
  const out = [];
  let from = startTime;
  while (from < endTime) {
    const url = `${REST}/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${from}&endTime=${endTime}&limit=1000`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Binance klines ${symbol} ${interval}: ${res.status}`);
    const rows = await res.json();
    if (!rows.length) break;
    for (const k of rows) out.push({ t: k[0], o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]) });
    from = rows[rows.length - 1][0] + 1;
    if (rows.length < 1000) break;
  }
  return out;
}
