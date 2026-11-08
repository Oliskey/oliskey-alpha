// A user's app settings follow them: saved from one device, read on another; each person sees only their own; only known names,
// and sizes are capped. Runs against a running backend.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API_URL || 'http://localhost:3311';

async function call(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const newUser = async (tag) => {
  const email = `set${tag}${Date.now()}@test.local`;
  const r = await call('POST', '/auth/register', { body: { fullName: 'Settings Test', email, password: 'password123' } });
  assert.ok(r.body?.token, JSON.stringify(r.body));
  return { email, token: r.body.token };
};

test('settings saved on one device are there when signing in on another', async () => {
  const a = await newUser('a');
  assert.deepEqual((await call('GET', '/me/settings', { token: a.token })).body.prefs, {}, 'a new account starts empty');
  assert.equal((await call('PUT', '/me/settings', { token: a.token, body: { name: 'theme', value: 'light' } })).status, 200);
  assert.equal((await call('PUT', '/me/settings', { token: a.token, body: { name: 'chart', value: '{"tf":60}' } })).status, 200);
  assert.equal((await call('PUT', '/me/settings', { token: a.token, body: { name: 'theme', value: 'dark' } })).status, 200, 'a newer choice replaces the old one');

  const other = (await call('POST', '/auth/login', { body: { email: a.email, password: 'password123' } })).body.token;   // "another phone"
  assert.deepEqual((await call('GET', '/me/settings', { token: other })).body.prefs, { theme: 'dark', chart: '{"tf":60}' });

  const b = await newUser('b');
  assert.deepEqual((await call('GET', '/me/settings', { token: b.token })).body.prefs, {}, 'another person never sees them');
});

test('only known settings, only text, and not too large', async () => {
  const { token } = await newUser('c');
  assert.equal((await call('PUT', '/me/settings', { token, body: { name: 'balance', value: '1000000' } })).status, 400);
  assert.equal((await call('PUT', '/me/settings', { token, body: { name: 'theme', value: { x: 1 } } })).status, 400);
  assert.equal((await call('PUT', '/me/settings', { token, body: { name: 'drawings', value: 'x'.repeat(90_001) } })).status, 400);
  for (const name of ['drawings', 'indicators', 'assetTabs', 'favorites']) {
    assert.equal((await call('PUT', '/me/settings', { token, body: { name, value: 'x'.repeat(89_000) } })).status, 200, name);
  }
  const over = await call('PUT', '/me/settings', { token, body: { name: 'chart', value: 'x'.repeat(89_000) } });
  assert.equal(over.status, 400, 'the account total is capped');
  assert.equal((await call('GET', '/me/settings')).status, 401, 'signed in only');
});
