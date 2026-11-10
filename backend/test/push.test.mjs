// Alert subscriptions. The server sends to the address it is given, so only real browser push services may be saved.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API_URL || 'http://localhost:3311';
const call = async (method, path, token, body) => {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', accept: 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
const signUp = async () => (await call('POST', '/auth/register', null, { fullName: 'Push Test', email: `p${Date.now()}${Math.random().toString(36).slice(2, 7)}@test.local`, password: 'password123' })).body.token;

test('alert routes need a login', async () => {
  assert.equal((await call('POST', '/push/subscribe', null, { subscription: {} })).status, 401);
  assert.equal((await call('GET', '/push/key')).status, 401);
});

test('only real push services are accepted', async () => {
  const token = await signUp();
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest', 'https://fcm.googleapis.com.evil.example/x', 'https://fcm.googleapis.com:8443/x', 'https://user@fcm.googleapis.com/x', 'not a url', 42]) {
    assert.equal((await call('POST', '/push/subscribe', token, { subscription: { endpoint, keys } })).status, 400, String(endpoint));
  }
  assert.equal((await call('POST', '/push/subscribe', token, { subscription: { endpoint: 'https://fcm.googleapis.com/x' } })).status, 400, 'needs its keys');
});

test('a device can be added and removed, and one person cannot remove another\'s', async () => {
  const [a, b] = [await signUp(), await signUp()];
  const endpoint = `https://fcm.googleapis.com/fcm/send/test-${Date.now()}`;
  assert.equal((await call('POST', '/push/subscribe', a, { subscription: { endpoint, keys } })).status, 201);
  assert.equal((await call('POST', '/push/unsubscribe', b, { endpoint })).status, 200);
  assert.equal((await call('POST', '/push/subscribe', a, { subscription: { endpoint, keys } })).status, 201, 'still theirs');
  assert.equal((await call('POST', '/push/unsubscribe', a, { endpoint })).status, 200);
});

test('at most five devices per person', async () => {
  const token = await signUp();
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/push/subscribe', token, { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/many-${Date.now()}-${i}`, keys } })).status, 201);
  assert.equal((await call('POST', '/push/subscribe', token, { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/many-${Date.now()}-x`, keys } })).status, 400);
});

// Root cause of "no alert on profit or loss": only results of followed signals were alerted, and the open app got no
// details to ring with. Now every result reaches the open app with its title and colour (and the browser alert).
test('the open app gets a ringing alert for an ordinary trade result', async () => {
  const { default: WebSocket } = await import('ws');
  const token = await signUp();
  assert.equal((await call('POST', '/me/onboarding', token, { answers: { lose: 'stake', demo: 'practice', ai: 'mine' }, aiMode: 'ask' })).status, 200);
  const demo = (await call('GET', '/me', token)).body.accounts.find((a) => a.type === 'DEMO');
  const ws = new WebSocket(API.replace('http', 'ws') + '/stream');
  await new Promise((r) => ws.once('open', r));
  const alerts = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'notification' && m.alert) alerts.push(m.alert); });
  ws.send(JSON.stringify({ type: 'auth', token }));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await call('POST', '/trades', token, { accountId: demo.id, assetId: 'EURUSD', mode: 'fixed_time', direction: 'up', amount: 100, durationSec: 5 })).status, 201);
  for (let i = 0; i < 40 && !alerts.some((a) => /^(Trade won|Trade lost|Amount returned)/.test(a.title)); i++) await new Promise((r) => setTimeout(r, 250));
  ws.close();
  const result = alerts.find((a) => /^(Trade won|Trade lost|Amount returned)/.test(a.title));
  assert.ok(result, 'result alert arrived: ' + JSON.stringify(alerts));
  assert.equal(result.category, 'activities');
  assert.equal(result.link, '/history');
  assert.equal(result.tone, /^Trade won/.test(result.title) ? 'up' : /^Trade lost/.test(result.title) ? 'down' : 'neutral');
});
