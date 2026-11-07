// "Always ask" or "auto trade": the choice each user makes, and what the server allows. Runs against a test server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earnsInTests, groupStopped, passesStrength, tooLate, withinLimits } from '../src/intel.js';

const API = process.env.API_URL || 'http://localhost:3311';
const call = async (method, path, token, body) => {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', accept: 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const signUp = async () => (await call('POST', '/auth/register', null, { fullName: 'Auto Test', email: `a${Date.now()}${Math.random().toString(36).slice(2, 7)}@test.local`, password: 'password123' })).body.token;

test('the hard limits on trades the AI places', () => {
  assert.equal(withinLimits(10000, 100, 0), true, 'a normal trade');
  assert.equal(withinLimits(10000, 1500, 0), true, 'exactly 15%');
  assert.equal(withinLimits(10000, 1501, 0), false, 'over 15% of the money');
  assert.equal(withinLimits(600, 100, 0), false, 'α100 is over 15% of α600');
  assert.equal(withinLimits(5000, 100, 4000), true, 'under half open, and one more still fits');
  assert.equal(withinLimits(5000, 100, 4900), false, 'one more would put over half in open trades');
  assert.equal(withinLimits(50, 100, 0), false, 'more than the balance');
});

test('the safety stop binds the AI: a paused, blocked or unknown group trades nothing', () => {
  const groups = { crypto_iz: { status: 'experimental', paused: null }, crypto_ft: { status: 'test', paused: 'The last 8 live signals all lost.' }, currency: { status: 'blocked', paused: null } };
  assert.equal(groupStopped(groups, 'crypto_iz'), false);
  assert.equal(groupStopped(groups, 'crypto_ft'), true);
  assert.equal(groupStopped(groups, 'currency'), true);
  assert.equal(groupStopped(groups, 'crypto_iz_wide'), true, 'a group with no test numbers');
  assert.equal(groupStopped(undefined, 'crypto_iz'), true, 'no answer from the engine');
});

test('a user\'s money only goes where testing earned', () => {
  const groups = { crypto_iz: { status: 'test', money_ok: true, test: { avg_r: 0.1 } }, crypto: { status: 'test', money_ok: false, test: { avg_r: 0.1 } }, crypto_ft: { status: 'test', paused: 'stop', money_ok: true, test: { avg_r: 0.1 } }, crypto_4h: { status: 'test', test: { avg_r: 0.2 } } };
  assert.equal(earnsInTests(groups, 'crypto_iz'), true);
  assert.equal(earnsInTests(groups, 'crypto'), false, 'a positive average without proof is not enough');
  assert.equal(earnsInTests(groups, 'crypto_ft'), false, 'paused, however good its tests');
  assert.equal(earnsInTests(groups, 'crypto_4h'), false, 'no proof given');
  assert.equal(earnsInTests(groups, 'nothing'), false);
});

test('the AI does not enter later than was tested', () => {
  const bar = '2026-11-07T10:00:00Z', at = (s) => new Date(bar).getTime() + s * 1000;
  assert.equal(tooLate(bar, at(10)), false);
  assert.equal(tooLate(bar, at(120)), false, 'exactly 2 minutes was tested');
  assert.equal(tooLate(bar, at(121)), true);
});

test('strongest signals only takes InZone readings at or above the proven bar', () => {
  assert.equal(passesStrength('all', null, 'forex', 0.1), true, 'most profit is not limited by this');
  assert.equal(passesStrength('strongest', 0.6, 'inzone', 0.61), true);
  assert.equal(passesStrength('strongest', 0.6, 'inzone', '0.6000'), true, 'the database gives a number as text');
  assert.equal(passesStrength('strongest', 0.6, 'inzone', 0.59), false);
  assert.equal(passesStrength('strongest', null, 'inzone', 0.99), false, 'no proven level: it waits');
  assert.equal(passesStrength('strongest', 0.6, 'forex', 0.99), false, 'other trade types were not tested for this');
});

test('everyone starts on most profit, and strongest signals cannot be chosen while no level has passed', async () => {
  const token = await signUp();
  const start = await call('GET', '/intel/auto', token);
  assert.equal(start.body.demo.strength, 'all');
  if (!start.body.strongest.offered) assert.equal((await call('PUT', '/intel/auto', token, { scope: 'demo', strength: 'strongest' })).status, 400);
  assert.equal((await call('PUT', '/intel/auto', token, { scope: 'demo', strength: 'nonsense' })).status, 400);
  assert.equal((await call('PUT', '/intel/auto', token, { scope: 'demo', strength: 'all' })).status, 200);
});

test('it needs a signed-in user', async () => {
  assert.equal((await call('GET', '/intel/auto')).status, 401);
  assert.equal((await call('PUT', '/intel/auto', null, { scope: 'demo', mode: 'ask' })).status, 401);
});

test('a new user starts on auto trade for demo and always ask for real, at the minimum amount', async () => {
  const { status, body } = await call('GET', '/intel/auto', await signUp());
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.min, 100);
  assert.deepEqual(body.demo, { mode: 'auto', amount: 100, strength: 'all', riskAccepted: false });
  assert.deepEqual(body.real, { mode: 'ask', amount: 100, strength: 'all', riskAccepted: false });
});

test('the user can switch demo either way and raise the amount, never below the minimum', async () => {
  const token = await signUp();
  assert.equal((await call('PUT', '/intel/auto', token, { scope: 'demo', mode: 'ask' })).body.demo.mode, 'ask');
  assert.equal((await call('PUT', '/intel/auto', token, { scope: 'demo', amount: 250 })).body.demo.amount, 250);
  const back = (await call('PUT', '/intel/auto', token, { scope: 'demo', mode: 'auto' })).body.demo;
  assert.deepEqual(back, { mode: 'auto', amount: 250, strength: 'all', riskAccepted: false }, 'changing one keeps the other');
  for (const amount of [99.99, 0, -100, 'lots', 1e12]) {
    assert.equal((await call('PUT', '/intel/auto', token, { scope: 'demo', amount })).status, 400, String(amount));
  }
  assert.equal((await call('GET', '/intel/auto', token)).body.demo.amount, 250);
});

test('bad requests are refused', async () => {
  const token = await signUp();
  assert.equal((await call('PUT', '/intel/auto', token, { scope: 'other', mode: 'auto' })).status, 400);
  assert.equal((await call('PUT', '/intel/auto', token, { scope: 'demo', mode: 'always' })).status, 400);
});

test('real money: auto trade needs the risk accepted first, and demo and real stay separate', async () => {
  const token = await signUp();
  const refused = await call('PUT', '/intel/auto', token, { scope: 'real', mode: 'auto' });
  assert.equal(refused.status, 400);
  assert.equal((await call('GET', '/intel/auto', token)).body.real.mode, 'ask');
  const fake = await call('PUT', '/intel/auto', token, { scope: 'demo', mode: 'ask', acceptRisk: true });
  assert.equal(fake.body.real.riskAccepted, false, 'accepting on demo does not count for real');
  const ok = (await call('PUT', '/intel/auto', token, { scope: 'real', mode: 'auto', acceptRisk: true })).body;
  assert.deepEqual(ok.real, { mode: 'auto', amount: 100, strength: 'all', riskAccepted: true });
  assert.equal(ok.demo.mode, 'ask');
  const asked = (await call('PUT', '/intel/auto', token, { scope: 'real', mode: 'ask' })).body.real;
  assert.deepEqual(asked, { mode: 'ask', amount: 100, strength: 'all', riskAccepted: true });
});
