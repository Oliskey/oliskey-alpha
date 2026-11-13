// NGN per USD for AI Trading checkout, read online (owner decision 2026-11-12: "it should always check online because it changes").
// Never guessed: two independent public sources are read and must agree within MAX_GAP, and each must be recent. If either is
// missing, stale or they disagree, there is no rate and checkout refuses (FX_RATE_UNAVAILABLE). The number is taken from the
// response text as written, so it never passes through floating point. A good answer is kept for CACHE_MS.
import { D, div, str, sub } from './decimal.js';

export const SOURCES = [
  { name: 'open.er-api.com', url: 'https://open.er-api.com/v6/latest/USD', rate: /"NGN"\s*:\s*(\d+(?:\.\d+)?)/, time: /"time_last_update_unix"\s*:\s*(\d+)/, unix: true },
  { name: 'currency-api', url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', backup: 'https://latest.currency-api.pages.dev/v1/currencies/usd.json', rate: /"ngn"\s*:\s*(\d+(?:\.\d+)?)/, time: /"date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/ },
];
export const MAX_GAP = '0.02';                 // the two sources may differ by at most 2%
export const MAX_AGE_MS = 3 * 24 * 3600_000;   // a source last updated more than 3 days ago is too old
const CACHE_MS = 60 * 60_000;                  // re-read at most once an hour

let cached = null;   // { rate, at, sources }

// One passing network hiccup should not close checkout: each source gets a second try (at its backup address if it has one).
async function readSource(s, fetchImpl, now) {
  try { return await readOnce(s, s.url, fetchImpl, now); }
  catch { return readOnce(s, s.backup ?? s.url, fetchImpl, now); }
}

async function readOnce(s, url, fetchImpl, now) {
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${s.name} ${r.status}`);
  const text = await r.text();
  // a source may send more than 8 decimals; the 6 kept below never need them
  const rate = text.match(s.rate)?.[1]?.replace(/(\.\d{8})\d+$/, '$1'), t = text.match(s.time)?.[1];
  if (!rate || !t) throw new Error(`${s.name}: no NGN rate`);
  const updated = s.unix ? Number(t) * 1000 : Date.parse(`${t}T00:00:00Z`);
  if (!(now - updated <= MAX_AGE_MS)) throw new Error(`${s.name}: rate is out of date`);
  if (D(rate) <= 0n) throw new Error(`${s.name}: bad rate`);
  return { name: s.name, rate: str(D(rate), 6), updated: new Date(updated).toISOString() };
}

/** The checked rate as a decimal string with 6 places, plus where it came from. Throws status 503 when it cannot be confirmed. */
export async function usdNgnRate({ fetchImpl = fetch, now = Date.now(), fresh = false } = {}) {
  if (!fresh && cached && now - cached.at < CACHE_MS) return cached;
  let read;
  try { read = await Promise.all(SOURCES.map((s) => readSource(s, fetchImpl, now))); }
  catch (err) { throw Object.assign(new Error('FX_RATE_UNAVAILABLE'), { status: 503, reason: err.message }); }
  const [a, b] = read;
  const gap = div(sub(a.rate, b.rate) < 0n ? sub(b.rate, a.rate) : sub(a.rate, b.rate), a.rate);
  if (gap > D(MAX_GAP)) throw Object.assign(new Error('FX_RATE_UNAVAILABLE'), { status: 503, reason: `sources disagree by ${str(gap * 100n, 2)}%` });
  cached = { rate: a.rate, at: now, sources: read };
  return cached;
}

export function forgetFxRate() { cached = null; }
