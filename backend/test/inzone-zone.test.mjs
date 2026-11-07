// The InZone corridor: live markets use real recent volatility, simulated markets keep the asset's fixed setting.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API_URL || 'http://localhost:3311';
const call = async (method, path, token, body) => {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', accept: 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const signUp = async () => {
  const { body } = await call('POST', '/auth/register', null, { fullName: 'Zone Test', email: `z${Date.now()}${Math.random().toString(36).slice(2, 7)}@test.local`, password: 'password123' });
  const me = await call('GET', '/me', body.token);
  return { token: body.token, demo: me.body.accounts.find((a) => a.type === 'DEMO').id };
};

test('the quote refuses bad requests', async () => {
  assert.equal((await call('GET', '/zone/NOPE?durationSec=60')).status, 404);
  for (const d of ['1', '99999', 'abc', '']) assert.equal((await call('GET', `/zone/BTCUSD?durationSec=${d}`)).status, 400, d);
});

test('a simulated market keeps its fixed corridor', async () => {
  const { token, demo } = await signUp();
  assert.equal((await call('GET', '/zone/EURUSD?durationSec=300')).body.zonePct, null);
  const asset = (await call('GET', '/assets')).body.find((a) => a.id === 'EURUSD');
  const t = await call('POST', '/trades', token, { accountId: demo, assetId: 'EURUSD', mode: 'inzone', amount: 10, durationSec: 300 });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.ok(Math.abs(Number(t.body.zone_pct) - Number(asset.volatility) * 0.6 * Math.sqrt(1200) * 100) < 1e-4);
});

test('a live market uses real blended volatility: narrower than the old fixed corridor, and wider for longer trades', async (t) => {
  const short = (await call('GET', '/zone/BTCUSD?durationSec=300')).body.zonePct;
  if (short == null) return t.skip('no recent live candles on this server');
  const long = (await call('GET', '/zone/BTCUSD?durationSec=1200')).body.zonePct;
  assert.ok(short > 0 && short < 0.166, `5 minutes: ${short}%`);
  assert.ok(Math.abs(long / short - 2) < 0.05, 'four times the time, twice the corridor');
  const { token, demo } = await signUp();
  const trade = await call('POST', '/trades', token, { accountId: demo, assetId: 'BTCUSD', mode: 'inzone', amount: 10, durationSec: 300 });
  assert.equal(trade.status, 201, JSON.stringify(trade.body));
  assert.ok(Math.abs(Number(trade.body.zone_pct) - short) / short < 0.2, `${trade.body.zone_pct} vs ${short}`);
});
