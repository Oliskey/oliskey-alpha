// "Notify me when live trading opens": join, leave, join again; each person changes only their own place. Needs the server on API_URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API_URL || 'http://localhost:3311';
async function call(method, path, token) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) } });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const user = async (tag) => (await (await fetch(`${API}/auth/register`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ fullName: 'Waitlist Test', email: `wl${tag}${Date.now()}@test.local`, password: 'password123' }),
})).json()).token;

test('join, leave and join again; one person never changes another', async () => {
  const [a, b] = [await user('a'), await user('b')];
  assert.deepEqual((await call('GET', '/trading/waitlist', a)).body, { joined: false, joinedAt: null });
  assert.equal((await call('POST', '/trading/waitlist', a)).body.joined, true);
  assert.equal((await call('POST', '/trading/waitlist', a)).body.joined, true, 'joining twice is fine');
  const joined = await call('GET', '/trading/waitlist', a);
  assert.equal(joined.body.joined, true);
  assert.ok(joined.body.joinedAt);
  assert.equal((await call('GET', '/trading/waitlist', b)).body.joined, false, 'the other person is not on the list');
  assert.equal((await call('DELETE', '/trading/waitlist', b)).status, 200, 'leaving when not on the list is harmless');
  assert.equal((await call('GET', '/trading/waitlist', a)).body.joined, true, "b leaving did not remove a");
  assert.equal((await call('DELETE', '/trading/waitlist', a)).body.joined, false);
  assert.equal((await call('GET', '/trading/waitlist', a)).body.joined, false);
  assert.equal((await call('POST', '/trading/waitlist', a)).body.joined, true, 'can join again');
});

test('no payment can start while live trading is closed or for an unapproved strategy', async () => {
  const t = await user('pay');
  const post = (path, body) => fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  for (const path of ['/trading/billing/checkout', '/trading/strategies/subscribe']) {
    const r = await post(path, { strategies: ['strict_swing'] });
    assert.equal(r.status, 409, path);
    assert.ok(['NOT_OPEN_YET', 'STRATEGY_NOT_APPROVED'].includes(r.body.code), path);
  }
  const fee = await post('/trading/commissions/00000000-0000-4000-8000-000000000000/pay', {});
  assert.equal(fee.status, 409);
  assert.equal(fee.body.code, 'NOT_OPEN_YET');
});

test('risk disclosure: not accepted at first, an old version is refused, acceptance is recorded and remembered', async () => {
  const t = await user('risk');
  const get = await call('GET', '/trading/risk-disclosure', t);
  assert.equal(get.status, 200);
  assert.equal(get.body.accepted, false);
  assert.equal(get.body.identityVerified, false, 'a new user is not verified');
  const post = (body) => fetch(`${API}/trading/risk-disclosure/accept`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  assert.equal((await post({ version: '2000-01-01' })).status, 400, 'an old text cannot be accepted');
  assert.equal((await post({ version: get.body.version })).body.accepted, true);
  const after = (await call('GET', '/trading/risk-disclosure', t)).body;
  assert.equal(after.accepted, true);
  assert.ok(after.acceptedAt);
});

test('signed in only', async () => {
  for (const m of ['GET', 'POST', 'DELETE']) assert.equal((await call(m, '/trading/waitlist')).status, 401, m);
});
