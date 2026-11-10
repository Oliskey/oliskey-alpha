// The same trade press sent several times (double tap, a retry after a timeout) opens exactly one trade.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API_URL || 'http://localhost:3311';
const RIGHT = { lose: 'stake', demo: 'practice', ai: 'mine' };   // the onboarding answers (see onboarding.test.mjs)

async function call(method, path, { token, body, key } = {}) {
  const res = await fetch(API + path, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...(key && { 'idempotency-key': key }) },
  });
  return { status: res.status, replay: res.headers.get('idempotent-replay'), body: await res.json().catch(() => null) };
}

async function trader() {
  const { body: { token } } = await call('POST', '/auth/register', { body: { fullName: 'Twice Tapper', email: `twice${Date.now()}${Math.random().toString(36).slice(2, 5)}@test.local`, password: 'password123' } });
  assert.equal((await call('POST', '/me/onboarding', { token, body: { answers: RIGHT, aiMode: 'ask' } })).status, 200);
  const me = (await call('GET', '/me', { token })).body;
  return { token, demo: me.accounts.find((a) => a.type === 'DEMO') };
}

const order = (accountId) => ({ accountId, assetId: 'EURUSD', mode: 'fixed_time', direction: 'up', amount: 10, durationSec: 60 });
const openCount = async (token) => (await call('GET', '/trades?status=open', { token })).body.trades.length;

test('five copies of one trade press, sent at once, open one trade and all get the same answer', async () => {
  const { token, demo } = await trader();
  const key = `press-${Date.now()}`;
  const answers = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/trades', { token, key, body: order(demo.id) })));
  assert.deepEqual(answers.map((a) => a.status), [201, 201, 201, 201, 201], JSON.stringify(answers.map((a) => a.body)));
  assert.equal(new Set(answers.map((a) => a.body.id)).size, 1, 'one trade id');
  assert.equal(answers.filter((a) => a.replay === 'true').length, 4, 'four replays');
  assert.equal(await openCount(token), 1);
  const later = await call('POST', '/trades', { token, key, body: order(demo.id) });
  assert.equal(later.body.id, answers[0].body.id, 'a retry minutes later gets the same trade');
  assert.equal(await openCount(token), 1);
});

test('a new press gets a new trade; requests without a key work as before; bad keys are refused', async () => {
  const { token, demo } = await trader();
  await call('POST', '/trades', { token, key: `press-a-${Date.now()}`, body: order(demo.id) });
  await call('POST', '/trades', { token, key: `press-b-${Date.now()}`, body: order(demo.id) });
  assert.equal((await call('POST', '/trades', { token, body: order(demo.id) })).status, 201);
  assert.equal(await openCount(token), 3);
  assert.equal((await call('POST', '/trades', { token, key: 'x', body: order(demo.id) })).status, 400);
  assert.equal(await openCount(token), 3);
});

test('keys belong to one person: someone else using the same key gets their own trade', async () => {
  const a = await trader();
  const b = await trader();
  const key = `shared-${Date.now()}`;
  const ta = await call('POST', '/trades', { token: a.token, key, body: order(a.demo.id) });
  const tb = await call('POST', '/trades', { token: b.token, key, body: order(b.demo.id) });
  assert.equal(tb.status, 201);
  assert.notEqual(ta.body.id, tb.body.id);
  assert.equal(tb.replay, null);
});

test('a refused request is answered the same way when repeated, and opens nothing', async () => {
  const { token, demo } = await trader();
  const key = `big-${Date.now()}`;
  const tooBig = { ...order(demo.id), amount: 1_000_000 };
  const first = await call('POST', '/trades', { token, key, body: tooBig });
  const again = await call('POST', '/trades', { token, key, body: tooBig });
  assert.equal(first.status, again.status);
  assert.ok(first.status >= 400 && first.status < 500);
  assert.equal(await openCount(token), 0);
});
