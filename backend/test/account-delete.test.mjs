// Delete account against a running backend: password required, blocked by open trades, then the person is
// anonymised: the old session stops working and the email/password no longer log in.
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

test('delete account: password, open trades, then anonymised and logged out', async () => {
  const email = `del${Date.now()}@test.local`;
  const reg = await call('POST', '/auth/register', { body: { fullName: 'Delete Me', email, password: 'password123' } });
  const token = reg.body.token;
  const demo = (await call('GET', '/me', { token })).body.accounts.find((a) => a.type === 'DEMO');

  assert.equal((await call('DELETE', '/me', { token, body: { password: 'wrong-pass' } })).status, 400);

  await call('POST', '/trades', { token, body: { accountId: demo.id, assetId: 'EURUSD', mode: 'fixed_time', direction: 'up', amount: 10, durationSec: 5 } });
  assert.equal((await call('DELETE', '/me', { token, body: { password: 'password123' } })).body.code, 'ACCOUNT_HAS_OPEN_TRADES');
  await sleep(6500);

  const del = await call('DELETE', '/me', { token, body: { password: 'password123' } });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((await call('GET', '/me', { token })).status, 401, 'old session no longer opens the profile');
  assert.equal((await call('POST', '/auth/login', { body: { email, password: 'password123' } })).status, 401, 'cannot log in again');
  assert.equal((await call('POST', '/trades', { token, body: { accountId: demo.id, assetId: 'EURUSD', mode: 'fixed_time', direction: 'up', amount: 10, durationSec: 5 } })).body.code,
    'INSUFFICIENT_FUNDS', 'demo credits are gone');
});
