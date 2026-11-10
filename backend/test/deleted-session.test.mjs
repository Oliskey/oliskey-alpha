// A deleted account's existing session must stop working everywhere: every API route and the live stream.
// Before the fix, the old token could refill the demo balance to 10,000 after deletion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const API = process.env.API_URL || 'http://localhost:3311';

async function call(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function streamAuth(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(API.replace(/^http/, 'ws') + '/stream');
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('no answer from the stream')); }, 5000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'authed' || msg.type === 'error') { clearTimeout(timer); ws.close(); resolve(msg.type); }
    });
    ws.on('error', reject);
  });
}

test('after deleting an account, its old session is refused by the API and the live stream', async () => {
  const email = `gone${Date.now()}@test.local`;
  const { body: { token } } = await call('POST', '/auth/register', { body: { fullName: 'Gone User', email, password: 'password123' } });
  const demo = (await call('GET', '/me', { token })).body.accounts.find((a) => a.type === 'DEMO');
  assert.equal(await streamAuth(token), 'authed', 'works before deletion');

  assert.equal((await call('DELETE', '/me', { token, body: { password: 'password123' } })).status, 200);

  assert.equal((await call('POST', '/accounts/demo/reset', { token })).status, 401, 'cannot refill the demo balance');
  assert.equal((await call('POST', '/trades', { token, body: { accountId: demo.id, assetId: 'EURUSD', mode: 'fixed_time', direction: 'up', amount: 10, durationSec: 30 } })).status, 401);
  assert.equal((await call('GET', '/trades', { token })).status, 401);
  assert.equal((await call('GET', '/payments/withdrawals', { token })).status, 401);
  assert.equal(await streamAuth(token), 'error', 'live stream refuses it too');
});

test('other people are not affected', async () => {
  const { body: { token } } = await call('POST', '/auth/register', { body: { fullName: 'Still Here', email: `here${Date.now()}@test.local`, password: 'password123' } });
  assert.equal((await call('GET', '/me', { token })).status, 200);
  assert.equal((await call('POST', '/accounts/demo/reset', { token })).status, 200);
  assert.equal(await streamAuth(token), 'authed');
});
