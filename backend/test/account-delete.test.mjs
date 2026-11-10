// Delete account against a running backend: password required, blocked by open trades, then the person is
// anonymised: the old session stops working and the email/password no longer log in.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';

after(() => pool.end());

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

test('delete account: password, open trades, then anonymised and logged out', async () => {
  const email = `del${Date.now()}@test.local`;
  const reg = await call('POST', '/auth/register', { body: { fullName: 'Delete Me', email, password: 'password123' } });
  const token = reg.body.token;
  // trading opens only after the short lessons (added after this test was written; see onboarding.test.mjs)
  assert.equal((await call('POST', '/me/onboarding', { token, body: { answers: { lose: 'stake', demo: 'practice', ai: 'mine' }, aiMode: 'ask' } })).status, 200);
  const demo = (await call('GET', '/me', { token })).body.accounts.find((a) => a.type === 'DEMO');

  assert.equal((await call('DELETE', '/me', { token, body: { password: 'wrong-pass' } })).status, 400);

  await call('POST', '/trades', { token, body: { accountId: demo.id, assetId: 'EURUSD', mode: 'fixed_time', direction: 'up', amount: 10, durationSec: 5 } });
  assert.equal((await call('DELETE', '/me', { token, body: { password: 'password123' } })).body.code, 'ACCOUNT_HAS_OPEN_TRADES');
  await sleep(6500);

  const del = await call('DELETE', '/me', { token, body: { password: 'password123' } });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((await call('GET', '/me', { token })).status, 401, 'old session no longer opens the profile');
  assert.equal((await call('POST', '/auth/login', { body: { email, password: 'password123' } })).status, 401, 'cannot log in again');
  // the old session is now refused outright (audit fix, see deleted-session.test.mjs), so it cannot even try to trade
  assert.equal((await call('POST', '/trades', { token, body: { accountId: demo.id, assetId: 'EURUSD', mode: 'fixed_time', direction: 'up', amount: 10, durationSec: 5 } })).status,
    401, 'the deleted account cannot trade');
  const left = (await pool.query(`select coalesce(sum(balance), 0)::numeric as b from accounts where id = $1`, [demo.id])).rows[0].b;
  assert.equal(Number(left), 0, 'demo credits are gone');
});
