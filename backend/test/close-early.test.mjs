// Close Early (Fixed Time) against a running backend: server-priced amount, timing window, 90% cap,
// and a trade can close exactly once even when requests race.
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

async function signUp() {
  const email = `ce${Date.now()}${Math.random().toString(36).slice(2, 7)}@test.local`;
  const r = await call('POST', '/auth/register', { body: { fullName: 'Early Test', email, password: 'password123' } });
  const me = await call('GET', '/me', { token: r.body.token });
  return { token: r.body.token, demo: me.body.accounts.find((a) => a.type === 'DEMO') };
}
const balance = async (u) => Number((await call('GET', '/me', { token: u.token })).body.accounts.find((a) => a.type === 'DEMO').balance);
const open = (u, body = {}) => call('POST', '/trades', { token: u.token, body: { accountId: u.demo.id, assetId: 'EURUSD', mode: 'fixed_time', direction: 'up', amount: 100, durationSec: 60, ...body } });

test('close early: priced by the server, capped at 90% of the win, paid once', async () => {
  const u = await signUp();
  const t = (await open(u)).body;

  const soon = await call('GET', `/trades/${t.id}/close-early`, { token: u.token });
  assert.equal(soon.body.available, false);
  assert.equal(soon.body.reason, 'CLOSE_EARLY_TOO_SOON');
  assert.equal((await call('POST', `/trades/${t.id}/close-early`, { token: u.token })).body.code, 'CLOSE_EARLY_TOO_SOON');

  await sleep(2300);
  const q = await call('GET', `/trades/${t.id}/close-early`, { token: u.token });
  assert.equal(q.body.available, true, JSON.stringify(q.body));
  assert.ok(q.body.amount >= 0 && q.body.amount <= 166.5, `amount ${q.body.amount} within 0..90% of 185`);

  const closed = await call('POST', `/trades/${t.id}/close-early`, { token: u.token });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.closed_early, true);
  const paid = Number(closed.body.return_amount);
  assert.ok(paid >= 0 && paid <= 166.5);
  assert.equal(await balance(u), Math.round((10000 - 100 + paid) * 100) / 100, 'balance = start - stake + early return');

  assert.equal((await call('POST', `/trades/${t.id}/close-early`, { token: u.token })).body.code, 'TRADE_ALREADY_CLOSED');
  assert.equal((await call('GET', `/trades/${t.id}/close-early`, { token: u.token })).status, 404);
});

test('close early: simultaneous requests close the trade exactly once', async () => {
  const u = await signUp();
  const t = (await open(u)).body;
  await sleep(2300);
  const results = await Promise.all(Array.from({ length: 5 }, () => call('POST', `/trades/${t.id}/close-early`, { token: u.token })));
  assert.equal(results.filter((r) => r.status === 200).length, 1, results.map((r) => r.status).join(','));
  const paid = Number(results.find((r) => r.status === 200).body.return_amount);
  assert.equal(await balance(u), Math.round((10000 - 100 + paid) * 100) / 100, 'paid once');
});

test('close early: refused near expiry, for other modes and for other users', async () => {
  const u = await signUp();
  const v = await signUp();
  const short = (await open(u, { durationSec: 5 })).body;
  const zone = (await open(u, { mode: 'inzone', direction: undefined })).body;
  const mine = (await open(u)).body;
  await sleep(2500);
  assert.equal((await call('POST', `/trades/${short.id}/close-early`, { token: u.token })).body.code, 'CLOSE_EARLY_TOO_LATE');
  assert.equal((await call('POST', `/trades/${zone.id}/close-early`, { token: u.token })).body.code, 'CLOSE_EARLY_NOT_ALLOWED');
  assert.equal((await call('GET', `/trades/${mine.id}/close-early`, { token: v.token })).status, 404, 'cannot see another user\'s quote');
  assert.equal((await call('POST', `/trades/${mine.id}/close-early`, { token: v.token })).status, 400, 'cannot close another user\'s trade');
});
