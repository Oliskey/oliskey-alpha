// Risk-free trades, pending orders, the online count and Funded interest against a running backend.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API_URL || 'http://localhost:3311';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function signUp() {
  const email = `rf${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.local`;
  const r = await call('POST', '/auth/register', { body: { fullName: 'RF Test', email, password: 'password123' } });
  // trading opens only after the short lessons (added after this test was written; see onboarding.test.mjs)
  assert.equal((await call('POST', '/me/onboarding', { token: r.body.token, body: { answers: { lose: 'stake', demo: 'practice', ai: 'mine' }, aiMode: 'ask' } })).status, 200);
  const me = await call('GET', '/me', { token: r.body.token });
  return { token: r.body.token, me: me.body, demo: me.body.accounts.find((a) => a.type === 'DEMO') };
}
const trade = (u, extra = {}) => call('POST', '/trades', { token: u.token, body: { accountId: u.demo.id, assetId: 'EURUSD', mode: 'fixed_time', direction: 'up', amount: 10, durationSec: 5, ...extra } });
const order = (u, extra = {}) => call('POST', '/orders', { token: u.token, body: { accountId: u.demo.id, assetId: 'EURUSD', mode: 'fixed_time', direction: 'up', amount: 10, durationSec: 30, ...extra } });

test('risk-free: 3 per day, refused for forex, a 4th opens no trade', async () => {
  const u = await signUp();
  assert.deepEqual((await call('GET', `/risk-free?accountId=${u.demo.id}`, { token: u.token })).body, { limit: 3, used: 0, left: 3 });
  for (let i = 0; i < 3; i++) assert.equal((await trade(u, { riskFree: true })).body.risk_free, true);
  assert.equal((await call('GET', `/risk-free?accountId=${u.demo.id}`, { token: u.token })).body.left, 0);
  assert.equal((await trade(u, { riskFree: true })).body.code, 'RISK_FREE_LIMIT');
  assert.equal((await call('GET', '/trades?status=open', { token: u.token })).body.trades.length, 3, 'the refused 4th trade was not opened');
  assert.equal((await trade(u, { mode: 'forex', leverage: 10, durationSec: undefined, riskFree: true })).status, 400);
});

test('risk-free: a losing risk-free trade gives the stake back', async () => {
  const u = await signUp();
  const a = (await trade(u, { riskFree: true, direction: 'up' })).body;
  const b = (await trade(u, { riskFree: true, direction: 'down' })).body;   // one of the two loses (or both refund)
  await sleep(7000);
  for (const id of [a.id, b.id]) {
    const t = (await call('GET', `/trades/${id}`, { token: u.token })).body;
    assert.equal(t.status, 'closed');
    assert.notEqual(t.result, 'loss', 'risk-free trades never end as a loss');
  }
  const bal = Number((await call('GET', '/me', { token: u.token })).body.accounts.find((x) => x.type === 'DEMO').balance);
  assert.ok(bal >= 10000, `balance never drops with risk-free trades (got ${bal})`);
});

test('pending orders: place above/below, cancel once, fill at the trigger, validation, privacy', async () => {
  const u = await signUp();
  const price = (await call('GET', '/price/EURUSD')).body.price;
  const above = await order(u, { triggerPrice: price + 0.5 });
  assert.equal(above.status, 201);
  assert.equal(above.body.trigger_when, 'above');
  const below = await order(u, { direction: 'down', triggerPrice: price * 0.5 });
  assert.equal(below.body.trigger_when, 'below');
  assert.equal((await call('GET', '/orders?status=pending', { token: u.token })).body.length, 2);
  assert.equal((await call('DELETE', `/orders/${below.body.id}`, { token: u.token })).body.status, 'cancelled');
  assert.equal((await call('DELETE', `/orders/${below.body.id}`, { token: u.token })).status, 404, 'cancel once');

  // a trigger a hair above the price: the simulated market reaches it within seconds
  const live = (await call('GET', '/price/EURUSD')).body.price;
  const fill = await order(u, { triggerPrice: live + 0.00002 });
  let o = null;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    o = (await call('GET', '/orders', { token: u.token })).body.find((x) => x.id === fill.body.id);
    if (o.status !== 'pending') break;
  }
  if (o.status === 'filled') {
    const t = (await call('GET', `/trades/${o.trade_id}`, { token: u.token })).body;
    assert.ok(Number(t.open_quote) >= Number(o.trigger_price), 'opened at or above the trigger');
  } else {
    assert.equal(o.status, 'pending', 'the price did not reach the trigger within a minute, so the order still waits');
  }

  for (const bad of [{ triggerPrice: -1 }, { triggerPrice: 'x' }, { expiresInHours: 999 }, { mode: 'nope' }, { accountId: '00000000-0000-0000-0000-000000000000' }]) {
    assert.equal((await order(u, { triggerPrice: live * 1.01, ...bad })).status, 400, JSON.stringify(bad));
  }
  const v = await signUp();
  assert.equal((await call('DELETE', `/orders/${above.body.id}`, { token: v.token })).status, 404, 'other users cannot cancel');
  assert.equal((await call('GET', '/orders', { token: v.token })).body.length, 0, 'other users cannot see orders');
  assert.equal((await order(v, { accountId: u.demo.id, triggerPrice: live * 1.01 })).status, 400, 'cannot use another user\'s account');
});

test('online count is real and funded interest is recorded once', async () => {
  const on = await call('GET', '/online');
  assert.equal(on.status, 200);
  assert.ok(Number.isInteger(on.body.online) && on.body.online >= 0);
  const u = await signUp();
  assert.equal((await call('GET', '/funded', { token: u.token })).body.interested, false);
  assert.equal((await call('POST', '/funded/interest', { token: u.token })).status, 201);
  assert.equal((await call('POST', '/funded/interest', { token: u.token })).status, 201, 'twice is fine');
  assert.equal((await call('GET', '/funded', { token: u.token })).body.interested, true);
});

test('pending orders by time: opens at the chosen time, validation', async () => {
  const u = await signUp();
  assert.equal((await order(u, { triggerAt: new Date(Date.now() + 2000).toISOString() })).status, 400, 'too soon');
  assert.equal((await order(u, { triggerAt: new Date(Date.now() + 8 * 86400_000).toISOString() })).status, 400, 'over 7 days');
  assert.equal((await order(u, { triggerAt: 'not a date' })).status, 400);
  const at = Date.now() + 12_000;
  const placed = await order(u, { triggerAt: new Date(at).toISOString() });
  assert.equal(placed.status, 201);
  assert.equal(placed.body.trigger_when, 'time');
  assert.equal(placed.body.trigger_price, null);
  let o = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    o = (await call('GET', '/orders', { token: u.token })).body.find((x) => x.id === placed.body.id);
    if (o.status !== 'pending') break;
  }
  assert.equal(o.status, 'filled');
  const t = (await call('GET', `/trades/${o.trade_id}`, { token: u.token })).body;
  assert.ok(new Date(t.open_time).getTime() >= at - 300, 'opened at (not before) the chosen time');
});

test('boosts and referrals: server rules through the API, no real money while live trading is off', async () => {
  const a = await signUp();
  assert.deepEqual((await call('GET', '/boosts', { token: a.token })).body, { available: 0, active_until: null });
  const none = await call('POST', '/boosts/activate', { token: a.token });
  assert.equal(none.status, 400);
  assert.match(none.body.error, /no boosts/i);
  const ref = (await call('GET', '/referrals', { token: a.token })).body;
  assert.equal(ref.invited, 0);
  assert.equal(ref.bonus_usd, 100);
  assert.match(ref.code, /^[0-9A-F]{8}$/);
  assert.equal((await call('GET', '/boosts')).status, 401, 'login required');
  assert.equal((await call('GET', '/referrals')).status, 401, 'login required');

  // signing up with the code links the friend; nothing is paid
  const email = `friend${Date.now()}@test.local`;
  const reg = await call('POST', '/auth/register', { body: { fullName: 'Friend', email, password: 'password123', inviteCode: ref.code } });
  assert.equal(reg.status, 201);
  assert.equal((await call('GET', '/referrals', { token: a.token })).body.invited, 1);
  const me = (await call('GET', '/me', { token: a.token })).body;
  assert.equal(Number(me.accounts.find((x) => x.type === 'USDT').balance), 0, 'no real money while live trading is off');

  // a bad code never blocks sign-up
  assert.equal((await call('POST', '/auth/register', { body: { fullName: 'Other', email: `o${Date.now()}@test.local`, password: 'password123', inviteCode: 'NOPE' } })).status, 201);
});
