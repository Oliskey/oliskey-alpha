// Exact decimal arithmetic for money. Values are BigInt counts of 10^-8 (the database stores numeric(28,8)), so there is
// never a floating-point rounding error. Inputs are strings (as pg returns numeric) or integers; never JS floats with
// fractions, which are refused so a rounded float cannot sneak into a balance.
export const SCALE = 8n;
const ONE = 10n ** SCALE;

export function D(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new TypeError(`decimal: pass "${v}" as a string, not a float`);
    return BigInt(v) * ONE;
  }
  if (typeof v !== 'string' || !/^-?\d+(\.\d+)?$/.test(v.trim())) throw new TypeError(`decimal: not a number: ${v}`);
  const s = v.trim(); const neg = s.startsWith('-');
  const [i, f = ''] = (neg ? s.slice(1) : s).split('.');
  if (f.length > Number(SCALE) && /[1-9]/.test(f.slice(Number(SCALE)))) throw new RangeError(`decimal: more than ${SCALE} decimals: ${v}`);
  const n = BigInt(i) * ONE + BigInt((f + '00000000').slice(0, Number(SCALE)));
  return neg ? -n : n;
}

export const add = (a, b) => D(a) + D(b);
export const sub = (a, b) => D(a) - D(b);
export const neg = (a) => -D(a);
export const cmp = (a, b) => { const x = D(a), y = D(b); return x < y ? -1 : x > y ? 1 : 0; };
export const max = (a, b) => (cmp(a, b) >= 0 ? D(a) : D(b));
export const min = (a, b) => (cmp(a, b) <= 0 ? D(a) : D(b));
export const isZero = (a) => D(a) === 0n;
export const sum = (xs) => xs.reduce((s, x) => s + D(x), 0n);

/** Division rounding toward zero ('down') or half-up away from zero ('half_up'), at 8 decimals. */
function divRound(n, d, mode) {
  if (d === 0n) throw new RangeError('decimal: division by zero');
  const q = n / d, r = n % d;
  if (mode === 'down' || r === 0n) return q;
  const twice = (r < 0n ? -r : r) * 2n, ad = d < 0n ? -d : d;
  return twice >= ad ? q + ((n < 0n) !== (d < 0n) ? -1n : 1n) : q;
}
export const mul = (a, b, mode = 'half_up') => divRound(D(a) * D(b), ONE, mode);
export const div = (a, b, mode = 'half_up') => divRound(D(a) * ONE, D(b), mode);

/** Round to `dp` decimals (dp <= 8): 'down' toward zero (fees we charge), 'half_up' for display, 'floor' for sizes. */
export function round(a, dp, mode = 'half_up') {
  const unit = 10n ** (SCALE - BigInt(dp)), x = D(a);
  if (mode === 'floor') { const q = x / unit; return (x < 0n && x % unit !== 0n ? q - 1n : q) * unit; }
  return divRound(x, unit, mode) * unit;
}

/** Largest multiple of `step` not above `a` (exchange lot / tick rules). */
export function floorToStep(a, step) {
  const s = D(step); if (s <= 0n) throw new RangeError('decimal: step must be positive');
  const x = D(a); return (x / s) * s - (x < 0n && x % s !== 0n ? s : 0n);
}
export const isMultipleOf = (a, step) => D(a) % D(step) === 0n;

/** Plain string with up to 8 decimals, trailing zeros removed ("12.5", "0", "-0.00000001"). */
export function str(a, dp) {
  let x = D(a); const neg = x < 0n; if (neg) x = -x;
  const i = x / ONE, f = (x % ONE).toString().padStart(Number(SCALE), '0');
  const frac = dp === undefined ? f.replace(/0+$/, '') : f.slice(0, dp).padEnd(dp, '0');
  return (neg && x !== 0n ? '-' : '') + i.toString() + (frac ? '.' + frac : '');
}
