// New users learn before they trade: the server refuses their trades until the lessons and the check are done, and the AI leaves them alone.
// Runs without the test preload that finishes the lessons for other tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrongAnswers } from '../src/onboarding.js';

const API = process.env.API_URL || 'http://localhost:3311';
const call = async (method, path, token, body) => {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const RIGHT = { lose: 'stake', demo: 'practice', ai: 'mine' };

test('the answers are checked by the server', () => {
  assert.deepEqual(wrongAnswers(RIGHT), []);
  assert.deepEqual(wrongAnswers({ ...RIGHT, ai: 'company' }), ['ai']);
  assert.deepEqual(wrongAnswers({}), ['lose', 'demo', 'ai']);
  assert.deepEqual(wrongAnswers(null), ['lose', 'demo', 'ai']);
});

test('a new user cannot trade until the lessons are done, then can', async () => {
  const reg = await call('POST', '/auth/register', null, { fullName: 'New Learner', email: `learn${Date.now()}@test.local`, password: 'password123' });
  assert.equal(reg.status, 201);
  const token = reg.body.token;
  const me = (await call('GET', '/me', token)).body;
  assert.equal(me.profile.onboarded_at, null, 'not done yet');
  const demo = me.accounts.find((a) => a.type === 'DEMO');
  const order = { accountId: demo.id, assetId: 'EURUSD', mode: 'fixed_time', direction: 'up', amount: 100, durationSec: 60 };
  const early = await call('POST', '/trades', token, order);
  assert.equal(early.status, 403, 'refused before the lessons');
  assert.match(early.body.error, /lessons/i);
  const auto = (await call('GET', '/intel/auto', token)).body;
  assert.equal(auto.onboarded, false, 'the AI knows to wait');

  const wrong = await call('POST', '/me/onboarding', token, { answers: { ...RIGHT, lose: 'nothing' }, aiMode: 'ask' });
  assert.equal(wrong.status, 400);
  assert.deepEqual(wrong.body.wrong, ['lose'], 'says which one to look at again');
  assert.equal((await call('POST', '/me/onboarding', token, { answers: RIGHT })).status, 400, 'the AI choice is required');
  assert.equal((await call('POST', '/me/onboarding', token, { answers: RIGHT, aiMode: 'sometimes' })).status, 400);

  const done = await call('POST', '/me/onboarding', token, { answers: RIGHT, aiMode: 'ask' });
  assert.equal(done.status, 200);
  const after = (await call('GET', '/me', token)).body;
  assert.ok(after.profile.onboarded_at, 'done');
  assert.equal((await call('GET', '/intel/auto', token)).body.demo.mode, 'ask', 'their AI choice is kept');
  assert.equal((await call('POST', '/trades', token, order)).status, 201, 'trading open');
  assert.equal((await call('POST', '/me/onboarding', token, { answers: RIGHT, aiMode: 'auto' })).status, 200, 'doing it again is harmless');
  assert.equal((await call('GET', '/intel/auto', token)).body.demo.mode, 'ask', 'and does not change their later choices');
});

test('the lessons need a signed-in user', async () => {
  assert.equal((await call('POST', '/me/onboarding', null, { answers: RIGHT, aiMode: 'ask' })).status, 401);
});
