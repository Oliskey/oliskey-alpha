// The AI Agents screen's data: read-only, login required, paper only, and no way to change a rule or place an order from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API_URL || 'http://localhost:3311';
const call = async (method, path, token) => {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) } });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('the agents record needs a login and is paper only', async () => {
  assert.equal((await call('GET', '/spot/agents')).status, 401);
  const reg = await fetch(API + '/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'Agent Viewer', email: `agents${Date.now()}@test.local`, password: 'password123' }) });
  const { token } = await reg.json();
  const r = await call('GET', '/spot/agents', token);
  assert.equal(r.status, 200);
  assert.equal(r.body.mode, 'paper_only');
  assert.equal(r.body.liveEnabled, false);
  assert.equal(typeof r.body.killSwitch.on, 'boolean');
  if (r.body.agents) {                                  // present once the intel engine has run on this database
    assert.equal(r.body.agents.cards.length, 14);
    assert.ok(Array.isArray(r.body.agents.improvements));
  }
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.ok([404, 405].includes((await call(m, '/spot/agents', token)).status), `${m} must not exist`);
  }
});

test('the light status call no longer carries the agents record', async () => {
  const reg = await fetch(API + '/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'Spot Viewer', email: `spotv${Date.now()}@test.local`, password: 'password123' }) });
  const { token } = await reg.json();
  const r = await call('GET', '/spot/status', token);
  assert.equal(r.status, 200);
  assert.ok(!r.body.paper || !('agents' in r.body.paper));
});

test('health says which version is running', async () => {
  const r = await call('GET', '/health');
  assert.equal(r.body.ok, true);
  assert.ok('commit' in r.body);
});
