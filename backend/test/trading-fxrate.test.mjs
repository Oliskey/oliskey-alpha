// The USD/NGN checkout rate is read online from two sources that must agree and be recent; otherwise there is no rate.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { forgetFxRate, usdNgnRate } from '../src/trading/fxRate.js';
import { usdToNgn } from '../src/trading/payments.js';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const answers = (er, ca, { erStatus = 200, caStatus = 200 } = {}) => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const first = url.includes('er-api');
    return { ok: (first ? erStatus : caStatus) === 200, status: first ? erStatus : caStatus, text: async () => (first ? er : ca) };
  };
  return { fetchImpl, calls };
};
const er = (ngn, at = NOW - 3600_000) => `{"result":"success","time_last_update_unix":${Math.floor(at / 1000)},"rates":{"USD":1,"NGN":${ngn}}}`;
const ca = (ngn, date = '2026-11-12') => `{"date": "${date}", "usd": {"eur": 0.86, "ngn": ${ngn}}}`;

beforeEach(() => forgetFxRate());

test('both sources agree: the first one is used, exactly as written', async () => {
  const { fetchImpl } = answers(er('1349.822603'), ca('1346.33221129123'));
  const r = await usdNgnRate({ fetchImpl, now: NOW });
  assert.equal(r.rate, '1349.822603');
  assert.deepEqual(r.sources.map((s) => s.name), ['open.er-api.com', 'currency-api']);
});

test('checkout amount: exact decimals, never floats', async () => {
  const { fetchImpl } = answers(er('1349.822603'), ca('1346.33'));
  const { amount, rate } = await usdToNgn('2.50', { fetchImpl, now: NOW });
  assert.equal(rate, '1349.822603');
  assert.equal(amount, '3374.56');   // 2.50 x 1349.822603 = 3374.5565075, rounded half up
});

test('the sources disagree by more than 2%: no rate', async () => {
  const { fetchImpl } = answers(er('1349.82'), ca('1500.00'));
  await assert.rejects(usdNgnRate({ fetchImpl, now: NOW }), (e) => e.message === 'FX_RATE_UNAVAILABLE' && e.status === 503 && /disagree/.test(e.reason));
});

test('a source that is down, out of date or has no NGN rate: no rate', async () => {
  await assert.rejects(usdNgnRate({ ...answers(er('1349.82'), ca('1346.33'), { caStatus: 500 }), now: NOW }), /FX_RATE_UNAVAILABLE/);
  forgetFxRate();
  await assert.rejects(usdNgnRate({ ...answers(er('1349.82', NOW - 5 * 24 * 3600_000), ca('1346.33')), now: NOW }), (e) => /out of date/.test(e.reason));
  forgetFxRate();
  await assert.rejects(usdNgnRate({ ...answers(er('1349.82'), ca('1346.33', '2026-11-01')), now: NOW }), (e) => /out of date/.test(e.reason));
  forgetFxRate();
  await assert.rejects(usdNgnRate({ ...answers('{"result":"error"}', ca('1346.33')), now: NOW }), (e) => /no NGN rate/.test(e.reason));
});

test('a good rate is kept for an hour, then read again', async () => {
  const a = answers(er('1349.82'), ca('1346.33'));
  await usdNgnRate({ fetchImpl: a.fetchImpl, now: NOW });
  await usdNgnRate({ fetchImpl: a.fetchImpl, now: NOW + 30 * 60_000 });
  assert.equal(a.calls.length, 2, 'one read of each source within the hour');
  await usdNgnRate({ fetchImpl: a.fetchImpl, now: NOW + 61 * 60_000 });
  assert.equal(a.calls.length, 4, 'read again after an hour');
});
