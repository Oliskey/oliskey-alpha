// Technical indicators and oscillators: definitions (name, settings, what it shows) and the maths.
// Every function takes the chart candles and returns series aligned with them by index. Series may run past the
// last candle (Alligator, Ichimoku cloud are drawn ahead in time) or start before it (Ichimoku lagging line).
// Standard textbook formulas; nothing here predicts anything, they only describe past prices.
import type { Candle } from '@/lib/api';

export type IndKey =
  | 'alligator' | 'bollinger' | 'donchian' | 'ema' | 'ichimoku' | 'keltner' | 'psar' | 'sentiment' | 'sma'
  | 'supertrend' | 'volume' | 'wma' | 'zigzag'
  | 'aroon' | 'adx' | 'atr' | 'ao' | 'bears' | 'bulls' | 'cci' | 'demarker' | 'dpo' | 'gator' | 'macd' | 'momentum'
  | 'roc' | 'rsi' | 'stoch' | 'willr' | 'bbpct' | 'stochrsi';

export type Param = { name: string; def: number; min: number; max: number; step?: number };
export type IndDef = {
  key: IndKey; label: string; group: 'indicator' | 'oscillator';
  about: string;            // one line: what it shows
  params: Param[];
  pane: boolean;            // drawn in its own panel under the chart
  needsVolume?: boolean;    // uses real buy/sell volume (live crypto only)
};
export type IndSetting = { id: string; key: IndKey; params: number[] };

const p = (name: string, def: number, min: number, max: number, step?: number): Param => ({ name, def, min, max, step });
const LEN = (def: number) => p('Period', def, 2, 200);

export const IND_DEFS: IndDef[] = [
  // on the price chart
  { key: 'alligator', label: 'Alligator', group: 'indicator', pane: false, about: 'Three smoothed averages: spread apart in a trend, tangled in a range', params: [p('Jaw', 13, 2, 100), p('Teeth', 8, 2, 100), p('Lips', 5, 2, 100)] },
  { key: 'bollinger', label: 'Bollinger Bands', group: 'indicator', pane: false, about: 'Average with bands 2 standard deviations away: wide when prices swing, narrow when calm', params: [LEN(20), p('Deviations', 2, 0.5, 5, 0.5)] },
  { key: 'donchian', label: 'Donchian Channel', group: 'indicator', pane: false, about: 'Highest high and lowest low of the period: breakouts leave the channel', params: [LEN(20)] },
  { key: 'ema', label: 'EMA', group: 'indicator', pane: false, about: 'Exponential moving average: recent prices count more', params: [LEN(20)] },
  { key: 'ichimoku', label: 'Ichimoku Cloud', group: 'indicator', pane: false, about: 'Trend, support and resistance in one view; the cloud is drawn 26 candles ahead', params: [p('Conversion', 9, 2, 100), p('Base', 26, 2, 100), p('Span B', 52, 2, 200)] },
  { key: 'keltner', label: 'Keltner Channel', group: 'indicator', pane: false, about: 'EMA with bands set by the average true range', params: [LEN(20), p('ATR multiplier', 2, 0.5, 5, 0.5)] },
  { key: 'psar', label: 'Parabolic SAR', group: 'indicator', pane: false, about: 'Dots that trail the price; when they flip sides the trend may be turning', params: [p('Step', 0.02, 0.01, 0.1, 0.01), p('Maximum', 0.2, 0.1, 0.5, 0.05)] },
  { key: 'sentiment', label: 'Sentiment', group: 'indicator', pane: true, needsVolume: true, about: 'Share of real buyer-started volume per candle (live crypto only)', params: [] },
  { key: 'sma', label: 'SMA', group: 'indicator', pane: false, about: 'Simple moving average: the plain average of the last closes', params: [LEN(20)] },
  { key: 'supertrend', label: 'Supertrend', group: 'indicator', pane: false, about: 'A stop line under rising prices and over falling ones', params: [p('ATR period', 10, 2, 100), p('Multiplier', 3, 0.5, 10, 0.5)] },
  { key: 'volume', label: 'Volume', group: 'indicator', pane: true, needsVolume: true, about: 'Real traded volume per candle, buyers green and sellers red (live crypto only)', params: [] },
  { key: 'wma', label: 'WMA', group: 'indicator', pane: false, about: 'Weighted moving average: weights fall in a straight line with age', params: [LEN(20)] },
  { key: 'zigzag', label: 'Zig Zag', group: 'indicator', pane: false, about: 'Joins swing highs and lows to show the main moves; the last leg can still change', params: [p('Depth', 5, 2, 50)] },
  // oscillators: own panel
  { key: 'aroon', label: 'Aroon', group: 'oscillator', pane: true, about: 'How recently the high and the low of the period were made', params: [LEN(14)] },
  { key: 'adx', label: 'Average Directional Index', group: 'oscillator', pane: true, about: 'Trend strength (ADX) with buying (+DI) and selling (−DI) pressure', params: [LEN(14)] },
  { key: 'atr', label: 'Average True Range', group: 'oscillator', pane: true, about: 'Average candle range including gaps: how much the price moves', params: [LEN(14)] },
  { key: 'ao', label: 'Awesome Oscillator', group: 'oscillator', pane: true, about: '5-candle minus 34-candle average of the midpoint', params: [p('Fast', 5, 2, 100), p('Slow', 34, 3, 200)] },
  { key: 'bears', label: 'Bears Power', group: 'oscillator', pane: true, about: 'Low minus the EMA: how far sellers pushed below the average', params: [LEN(13)] },
  { key: 'bulls', label: 'Bulls Power', group: 'oscillator', pane: true, about: 'High minus the EMA: how far buyers pushed above the average', params: [LEN(13)] },
  { key: 'cci', label: 'CCI', group: 'oscillator', pane: true, about: 'Commodity Channel Index: distance from the average in typical deviations', params: [LEN(20)] },
  { key: 'demarker', label: 'DeMarker', group: 'oscillator', pane: true, about: 'Compares new highs with new lows; near 0.7 stretched up, near 0.3 stretched down', params: [LEN(14)] },
  { key: 'dpo', label: 'Detrended Price Oscillator', group: 'oscillator', pane: true, about: 'Price minus a past average: shows cycles without the trend', params: [LEN(20)] },
  { key: 'gator', label: 'Gator', group: 'oscillator', pane: true, about: 'Gaps between the Alligator lines: growing bars mean a trend is waking up', params: [p('Jaw', 13, 2, 100), p('Teeth', 8, 2, 100), p('Lips', 5, 2, 100)] },
  { key: 'macd', label: 'MACD', group: 'oscillator', pane: true, about: 'Fast EMA minus slow EMA, its signal line and the gap between them', params: [p('Fast', 12, 2, 100), p('Slow', 26, 3, 200), p('Signal', 9, 2, 100)] },
  { key: 'momentum', label: 'Momentum', group: 'oscillator', pane: true, about: 'Close minus the close N candles ago', params: [LEN(14)] },
  { key: 'roc', label: 'Rate Of Change', group: 'oscillator', pane: true, about: 'Percent change from N candles ago', params: [LEN(14)] },
  { key: 'rsi', label: 'RSI', group: 'oscillator', pane: true, about: 'Relative Strength Index: above 70 stretched up, below 30 stretched down', params: [LEN(14)] },
  { key: 'stoch', label: 'Stochastic', group: 'oscillator', pane: true, about: 'Where the close sits in the recent range (%K) and its average (%D)', params: [LEN(14), p('%K smoothing', 3, 1, 20), p('%D', 3, 1, 20)] },
  { key: 'willr', label: 'Williams %R', group: 'oscillator', pane: true, about: 'Close against the recent high-low range, from 0 to −100', params: [LEN(14)] },
  { key: 'bbpct', label: 'Bollinger %B', group: 'oscillator', pane: true, about: 'Where the price sits between the Bollinger Bands (0 = lower, 1 = upper)', params: [LEN(20), p('Deviations', 2, 0.5, 5, 0.5)] },
  { key: 'stochrsi', label: 'Stochastic RSI', group: 'oscillator', pane: true, about: 'Stochastic applied to RSI: faster and more sensitive than RSI', params: [p('RSI period', 14, 2, 100), p('Stoch period', 14, 2, 100), p('%K', 3, 1, 20), p('%D', 3, 1, 20)] },
];
export const indDef = (key: IndKey) => IND_DEFS.find((d) => d.key === key)!;
export const defaults = (key: IndKey) => indDef(key).params.map((x) => x.def);
export const indTitle = (s: IndSetting) => `${indDef(s.key).label}${s.params.length ? ' ' + s.params.join(', ') : ''}`;

// Line colours: own palette, readable on black.
export const IND_COLORS = ['#F5B942', '#3BA4FF', '#C77DFF', '#2EE6D0', '#FF8A3D', '#FF6FB5'];
const UP = '#00D27A', DOWN = '#FF3D5A', BLUE = '#3BA4FF', GOLD = '#F5B942', VIOLET = '#C77DFF', GREY = '#A0A0A8';

type V = (number | null)[];
export type Line = { v: V; color: string; width?: number; dash?: boolean; label?: string };
export type IndOut = {
  lines: Line[];
  hist?: { v: V; colors: string[] };                // pane bars
  hist2?: { v: V; colors: string[] };               // second bar set (Gator: below zero)
  dots?: { v: V; colors: string[] };                // Parabolic SAR
  cloud?: { a: V; b: V };                           // Ichimoku: filled between a and b
  band?: { upper: V; lower: V; color: string };     // light fill between two lines
  zig?: { i: number; p: number }[];
  levels?: number[];                                // dashed guide lines in a pane
  range?: [number, number];                         // fixed pane scale
  note?: string;                                    // shown instead of data (e.g. no volume for simulated prices)
};

// ── building blocks ──
const nulls = (n: number): V => new Array(n).fill(null);
function sma(src: V, n: number): V {
  const out = nulls(src.length); let sum = 0, cnt = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i]; if (x == null) { sum = 0; cnt = 0; continue; }
    sum += x; cnt++;
    if (cnt > n) { sum -= src[i - n] as number; cnt = n; }
    if (cnt === n) out[i] = sum / n;
  }
  return out;
}
function ema(src: V, n: number): V {
  const out = nulls(src.length); const k = 2 / (n + 1); let prev: number | null = null; let seed: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const x = src[i]; if (x == null) continue;
    if (prev == null) { seed.push(x); if (seed.length === n) { prev = seed.reduce((a, b) => a + b, 0) / n; out[i] = prev; seed = []; } continue; }
    prev = x * k + prev * (1 - k); out[i] = prev;
  }
  return out;
}
// Wilder smoothing (RSI, ATR, ADX, Alligator's SMMA)
function rma(src: V, n: number): V {
  const out = nulls(src.length); let prev: number | null = null; let seed: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const x = src[i]; if (x == null) continue;
    if (prev == null) { seed.push(x); if (seed.length === n) { prev = seed.reduce((a, b) => a + b, 0) / n; out[i] = prev; } continue; }
    prev = (prev * (n - 1) + x) / n; out[i] = prev;
  }
  return out;
}
function wma(src: V, n: number): V {
  const out = nulls(src.length); const den = (n * (n + 1)) / 2;
  for (let i = n - 1; i < src.length; i++) {
    let s = 0, ok = true;
    for (let k = 0; k < n; k++) { const x = src[i - k]; if (x == null) { ok = false; break; } s += x * (n - k); }
    if (ok) out[i] = s / den;
  }
  return out;
}
function stdev(src: V, n: number, mean: V): V {
  const out = nulls(src.length);
  for (let i = n - 1; i < src.length; i++) {
    const m = mean[i]; if (m == null) continue;
    let s = 0; for (let k = 0; k < n; k++) s += ((src[i - k] as number) - m) ** 2;
    out[i] = Math.sqrt(s / n);
  }
  return out;
}
const highest = (src: number[], n: number): V => src.map((_, i) => (i < n - 1 ? null : Math.max(...src.slice(i - n + 1, i + 1))));
const lowest = (src: number[], n: number): V => src.map((_, i) => (i < n - 1 ? null : Math.min(...src.slice(i - n + 1, i + 1))));
const sub = (a: V, b: V): V => a.map((x, i) => (x == null || b[i] == null ? null : x - (b[i] as number)));
const shift = (src: V, by: number): V => {   // by > 0: draw later (ahead); by < 0: draw earlier
  const out = nulls(Math.max(src.length, src.length + by));
  src.forEach((x, i) => { if (i + by >= 0) out[i + by] = x; });
  return out;
};
function trueRange(cs: Candle[]): V {
  return cs.map((c, i) => (i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - cs[i - 1].close), Math.abs(c.low - cs[i - 1].close))));
}
function rsi(src: V, n: number): V {
  const gain: V = src.map((x, i) => (i === 0 || x == null || src[i - 1] == null ? null : Math.max(0, x - (src[i - 1] as number))));
  const loss: V = src.map((x, i) => (i === 0 || x == null || src[i - 1] == null ? null : Math.max(0, (src[i - 1] as number) - x)));
  const g = rma(gain, n), l = rma(loss, n);
  return g.map((x, i) => (x == null || l[i] == null ? null : l[i] === 0 ? 100 : 100 - 100 / (1 + x / (l[i] as number))));
}
function stochOf(src: V, n: number): V {
  return src.map((x, i) => {
    if (x == null || i < n - 1) return null;
    const win = src.slice(i - n + 1, i + 1); if (win.some((w) => w == null)) return null;
    const hi = Math.max(...(win as number[])), lo = Math.min(...(win as number[]));
    return hi === lo ? 50 : ((x - lo) / (hi - lo)) * 100;
  });
}
const histColors = (v: V) => v.map((x, i) => ((x ?? 0) >= (v[i - 1] ?? x ?? 0) ? UP : DOWN));
const signColors = (v: V) => v.map((x) => ((x ?? 0) >= 0 ? UP : DOWN));

export type VolumeBar = { time: number; buy: number; sell: number };

// ── the indicators ──
export function computeIndicator(s: IndSetting, cs: Candle[], volume: VolumeBar[] | null): IndOut {
  const n = cs.length;
  const close = cs.map((c) => c.close), high = cs.map((c) => c.high), low = cs.map((c) => c.low);
  const median = cs.map((c) => (c.high + c.low) / 2);
  const [a = 0, b = 0, c3 = 0, d4 = 0] = s.params;
  switch (s.key) {
    case 'sma': return { lines: [{ v: sma(close, a), color: GOLD }] };
    case 'ema': return { lines: [{ v: ema(close, a), color: BLUE }] };
    case 'wma': return { lines: [{ v: wma(close, a), color: VIOLET }] };
    case 'alligator': {
      return { lines: [
        { v: shift(rma(median, a), 8), color: BLUE, label: 'Jaw' },
        { v: shift(rma(median, b), 5), color: DOWN, label: 'Teeth' },
        { v: shift(rma(median, c3), 3), color: UP, label: 'Lips' },
      ] };
    }
    case 'bollinger': {
      const mid = sma(close, a), sd = stdev(close, a, mid);
      const upper = mid.map((m, i) => (m == null ? null : m + b * (sd[i] as number)));
      const lower = mid.map((m, i) => (m == null ? null : m - b * (sd[i] as number)));
      return { lines: [{ v: upper, color: BLUE }, { v: mid, color: GOLD, dash: true }, { v: lower, color: BLUE }], band: { upper, lower, color: BLUE } };
    }
    case 'donchian': {
      const upper = highest(high, a), lower = lowest(low, a);
      const mid = upper.map((u, i) => (u == null ? null : (u + (lower[i] as number)) / 2));
      return { lines: [{ v: upper, color: UP }, { v: mid, color: GREY, dash: true }, { v: lower, color: DOWN }], band: { upper, lower, color: BLUE } };
    }
    case 'keltner': {
      const mid = ema(close, a), atr = rma(trueRange(cs), 10);
      const upper = mid.map((m, i) => (m == null || atr[i] == null ? null : m + b * (atr[i] as number)));
      const lower = mid.map((m, i) => (m == null || atr[i] == null ? null : m - b * (atr[i] as number)));
      return { lines: [{ v: upper, color: VIOLET }, { v: mid, color: GOLD, dash: true }, { v: lower, color: VIOLET }], band: { upper, lower, color: VIOLET } };
    }
    case 'ichimoku': {
      const mid = (len: number) => { const h = highest(high, len), l = lowest(low, len); return h.map((x, i) => (x == null ? null : (x + (l[i] as number)) / 2)); };
      const conv = mid(a), base = mid(b);
      const spanA = shift(conv.map((x, i) => (x == null || base[i] == null ? null : (x + (base[i] as number)) / 2)), b);
      const spanB = shift(mid(c3), b);
      const lag = shift(close, -b);
      return {
        lines: [
          { v: conv, color: BLUE, label: 'Conversion' }, { v: base, color: DOWN, label: 'Base' },
          { v: spanA, color: UP, width: 1 }, { v: spanB, color: DOWN, width: 1 }, { v: lag, color: VIOLET, width: 1, label: 'Lagging' },
        ],
        cloud: { a: spanA, b: spanB },
      };
    }
    case 'psar': {
      const v = nulls(n), colors: string[] = new Array(n).fill(UP);
      if (n < 3) return { lines: [], dots: { v, colors } };
      let up = cs[1].close >= cs[0].close, af = a, ep = up ? cs[0].high : cs[0].low, sar = up ? cs[0].low : cs[0].high;
      for (let i = 1; i < n; i++) {
        sar = sar + af * (ep - sar);
        if (up) {
          sar = Math.min(sar, cs[i - 1].low, cs[Math.max(0, i - 2)].low);
          if (cs[i].low < sar) { up = false; sar = ep; ep = cs[i].low; af = a; }
          else if (cs[i].high > ep) { ep = cs[i].high; af = Math.min(b, af + a); }
        } else {
          sar = Math.max(sar, cs[i - 1].high, cs[Math.max(0, i - 2)].high);
          if (cs[i].high > sar) { up = true; sar = ep; ep = cs[i].high; af = a; }
          else if (cs[i].low < ep) { ep = cs[i].low; af = Math.min(b, af + a); }
        }
        v[i] = sar; colors[i] = up ? UP : DOWN;
      }
      return { lines: [], dots: { v, colors } };
    }
    case 'supertrend': {
      const atr = rma(trueRange(cs), a);
      const upV = nulls(n), dnV = nulls(n);
      let fu = 0, fl = 0, dirUp = true, started = false;
      for (let i = 0; i < n; i++) {
        const t = atr[i]; if (t == null) continue;
        const bu = median[i] + b * t, bl = median[i] - b * t;
        if (!started) { fu = bu; fl = bl; started = true; dirUp = close[i] >= median[i]; }
        else {
          fu = bu < fu || close[i - 1] > fu ? bu : fu;
          fl = bl > fl || close[i - 1] < fl ? bl : fl;
          if (dirUp && close[i] < fl) dirUp = false; else if (!dirUp && close[i] > fu) dirUp = true;
        }
        if (dirUp) upV[i] = fl; else dnV[i] = fu;
      }
      return { lines: [{ v: upV, color: UP, width: 2 }, { v: dnV, color: DOWN, width: 2 }] };
    }
    case 'zigzag': {
      // swing points: a high (low) that is the highest (lowest) within `a` candles on each side; then alternate,
      // keeping the more extreme of two swings in a row. The newest candle is added as a provisional last point.
      const pts: { i: number; p: number; hi: boolean }[] = [];
      for (let i = a; i < n - a; i++) {
        let isHi = true, isLo = true;
        for (let k = i - a; k <= i + a; k++) { if (high[k] > high[i]) isHi = false; if (low[k] < low[i]) isLo = false; }
        for (const [ok, hi, price] of [[isHi, true, high[i]], [isLo, false, low[i]]] as const) {
          if (!ok) continue;
          const last = pts[pts.length - 1];
          if (last && last.hi === hi) { if (hi ? price > last.p : price < last.p) pts[pts.length - 1] = { i, p: price, hi }; }
          else pts.push({ i, p: price, hi });
        }
      }
      if (n && pts.length) { const last = pts[pts.length - 1]; pts.push({ i: n - 1, p: last.hi ? low[n - 1] : high[n - 1], hi: !last.hi }); }
      return { lines: [], zig: pts.map(({ i, p: price }) => ({ i, p: price })) };
    }
    case 'volume': case 'sentiment': {
      if (!volume) return { lines: [], note: 'Real volume is available for live crypto only. Simulated prices have no buyers or sellers.' };
      const byTime = new Map(volume.map((v) => [v.time, v]));
      if (s.key === 'volume') {
        const v = cs.map((c) => { const x = byTime.get(c.time); return x ? x.buy + x.sell : null; });
        return { lines: [], hist: { v, colors: cs.map((c) => { const x = byTime.get(c.time); return !x || x.buy >= x.sell ? UP : DOWN; }) }, note: v.some((x) => x != null) ? undefined : 'No trades recorded yet for these candles (volume is kept 24 h).' };
      }
      const v = cs.map((c) => { const x = byTime.get(c.time); return x && x.buy + x.sell > 0 ? (x.buy / (x.buy + x.sell)) * 100 : null; });
      return { lines: [{ v, color: GOLD, label: 'Buyers %' }], levels: [50], range: [0, 100], note: v.some((x) => x != null) ? undefined : 'No trades recorded yet for these candles (kept 24 h).' };
    }
    // ── oscillators ──
    case 'rsi': return { lines: [{ v: rsi(close, a), color: VIOLET }], levels: [30, 70], range: [0, 100] };
    case 'stochrsi': {
      const k = sma(stochOf(rsi(close, a), b), c3), dd = sma(k, d4);
      return { lines: [{ v: k, color: BLUE, label: '%K' }, { v: dd, color: GOLD, label: '%D' }], levels: [20, 80], range: [0, 100] };
    }
    case 'stoch': {
      const hh = highest(high, a), ll = lowest(low, a);
      const raw = close.map((x, i) => { const h = hh[i], l = ll[i]; return h == null || l == null ? null : h === l ? 50 : ((x - l) / (h - l)) * 100; });
      const k = sma(raw, b), dd = sma(k, c3);
      return { lines: [{ v: k, color: BLUE, label: '%K' }, { v: dd, color: GOLD, label: '%D' }], levels: [20, 80], range: [0, 100] };
    }
    case 'willr': {
      const h = highest(high, a), l = lowest(low, a);
      return { lines: [{ v: close.map((x, i) => (h[i] == null ? null : h[i] === l[i] ? -50 : ((h[i]! - x) / (h[i]! - l[i]!)) * -100)), color: VIOLET }], levels: [-80, -20], range: [-100, 0] };
    }
    case 'cci': {
      const tp = cs.map((c) => (c.high + c.low + c.close) / 3), m = sma(tp, a);
      const v = tp.map((x, i) => {
        if (m[i] == null) return null;
        let md = 0; for (let k = 0; k < a; k++) md += Math.abs(tp[i - k] - (m[i] as number));
        md /= a; return md === 0 ? 0 : (x - (m[i] as number)) / (0.015 * md);
      });
      return { lines: [{ v, color: GOLD }], levels: [-100, 100] };
    }
    case 'macd': {
      const line = sub(ema(close, a), ema(close, b)), sig = ema(line, c3), h = sub(line, sig);
      return { lines: [{ v: line, color: BLUE, label: 'MACD' }, { v: sig, color: GOLD, label: 'Signal' }], hist: { v: h, colors: signColors(h) }, levels: [0] };
    }
    case 'momentum': return { lines: [{ v: close.map((x, i) => (i < a ? null : x - close[i - a])), color: BLUE }], levels: [0] };
    case 'roc': return { lines: [{ v: close.map((x, i) => (i < a ? null : ((x - close[i - a]) / close[i - a]) * 100)), color: BLUE }], levels: [0] };
    case 'atr': return { lines: [{ v: rma(trueRange(cs), a), color: GOLD }] };
    case 'ao': { const v = sub(sma(median, a), sma(median, b)); return { lines: [], hist: { v, colors: histColors(v) }, levels: [0] }; }
    case 'bears': { const v = sub(low, ema(close, a)); return { lines: [], hist: { v, colors: signColors(v) }, levels: [0] }; }
    case 'bulls': { const v = sub(high, ema(close, a)); return { lines: [], hist: { v, colors: signColors(v) }, levels: [0] }; }
    case 'dpo': {
      const m = sma(close, a), back = Math.floor(a / 2) + 1;
      return { lines: [{ v: close.map((_, i) => (i < back || m[i] == null ? null : close[i - back] - (m[i] as number))), color: BLUE }], levels: [0] };
    }
    case 'demarker': {
      const dmax: V = high.map((h, i) => (i === 0 ? null : Math.max(0, h - high[i - 1])));
      const dmin: V = low.map((l, i) => (i === 0 ? null : Math.max(0, low[i - 1] - l)));
      const sx = sma(dmax, a), sn = sma(dmin, a);
      return { lines: [{ v: sx.map((x, i) => (x == null || sn[i] == null ? null : x + (sn[i] as number) === 0 ? 0.5 : x / (x + (sn[i] as number)))), color: GOLD }], levels: [0.3, 0.7], range: [0, 1] };
    }
    case 'aroon': {
      const up = high.map((_, i) => { if (i < a) return null; const w = high.slice(i - a, i + 1); return ((a - (a - w.lastIndexOf(Math.max(...w)))) / a) * 100; });
      const dn = low.map((_, i) => { if (i < a) return null; const w = low.slice(i - a, i + 1); return ((a - (a - w.lastIndexOf(Math.min(...w)))) / a) * 100; });
      return { lines: [{ v: up, color: UP, label: 'Up' }, { v: dn, color: DOWN, label: 'Down' }], range: [0, 100], levels: [50] };
    }
    case 'adx': {
      const plusDM: V = cs.map((c, i) => { if (i === 0) return null; const u = c.high - cs[i - 1].high, d = cs[i - 1].low - c.low; return u > d && u > 0 ? u : 0; });
      const minusDM: V = cs.map((c, i) => { if (i === 0) return null; const u = c.high - cs[i - 1].high, d = cs[i - 1].low - c.low; return d > u && d > 0 ? d : 0; });
      const tr = rma(trueRange(cs).map((x, i) => (i === 0 ? null : x)), a);
      const pdi = rma(plusDM, a).map((x, i) => (x == null || !tr[i] ? null : (x / (tr[i] as number)) * 100));
      const mdi = rma(minusDM, a).map((x, i) => (x == null || !tr[i] ? null : (x / (tr[i] as number)) * 100));
      const dx = pdi.map((x, i) => (x == null || mdi[i] == null || x + (mdi[i] as number) === 0 ? null : (Math.abs(x - (mdi[i] as number)) / (x + (mdi[i] as number))) * 100));
      return { lines: [{ v: rma(dx, a), color: GOLD, width: 2, label: 'ADX' }, { v: pdi, color: UP, label: '+DI' }, { v: mdi, color: DOWN, label: '−DI' }], levels: [25] };
    }
    case 'bbpct': {
      const mid = sma(close, a), sd = stdev(close, a, mid);
      return { lines: [{ v: close.map((x, i) => (mid[i] == null || !sd[i] ? null : (x - ((mid[i] as number) - b * (sd[i] as number))) / (2 * b * (sd[i] as number)))), color: BLUE }], levels: [0, 1] };
    }
    case 'gator': {
      const jaw = shift(rma(median, a), 8), teeth = shift(rma(median, b), 5), lips = shift(rma(median, c3), 3);
      const top: V = jaw.slice(0, n).map((j, i) => (j == null || teeth[i] == null ? null : Math.abs(j - (teeth[i] as number))));
      const bot: V = teeth.slice(0, n).map((t, i) => (t == null || lips[i] == null ? null : -Math.abs(t - (lips[i] as number))));
      const shrink = (v: V) => v.map((x, i) => (i > 0 && x != null && v[i - 1] != null && Math.abs(x) < Math.abs(v[i - 1] as number) ? DOWN : UP));
      return { lines: [], hist: { v: top, colors: shrink(top) }, hist2: { v: bot, colors: shrink(bot) }, levels: [0] };
    }
  }
}
