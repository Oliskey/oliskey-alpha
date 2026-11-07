// API hardening (audit phase 3): every protected route refuses anonymous and non-admin callers,
// and hostile or malformed input gets a clean 4xx, never a 500 or another user's data.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API_URL || 'http://localhost:3311';
const ZERO = '00000000-0000-0000-0000-000000000000';

async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

async function signUp() {
  const email = `s${Date.now()}${Math.random().toString(36).slice(2, 7)}@test.local`;
  const r = await call('POST', '/auth/register', { body: { fullName: 'Sec Test', email, password: 'password123' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const me = await call('GET', '/me', { token: r.body.token });
  return { token: r.body.token, me: me.body, demo: me.body.accounts.find((a) => a.type === 'DEMO') };
}

const PROTECTED = [
  ['GET', '/me'], ['PATCH', '/me'], ['DELETE', '/me'], ['GET', '/notifications'], ['POST', '/notifications/read'], ['GET', '/transactions'],
  ['GET', '/tasks'], ['POST', `/tasks/${ZERO}/accept`], ['GET', '/risk-free'], ['GET', '/orders'], ['POST', '/orders'], ['DELETE', `/orders/${ZERO}`], ['GET', '/funded'], ['POST', '/funded/interest'], ['GET', '/promo-codes'], ['POST', '/accounts/demo/reset'],
  ['GET', '/trades'], ['POST', '/trades'], ['GET', `/trades/${ZERO}`], ['POST', `/trades/${ZERO}/close`], ['POST', `/trades/${ZERO}/analyze`],
  ['POST', '/payments/deposit'], ['GET', `/payments/verify/x`], ['POST', '/payments/withdraw'], ['GET', '/payments/withdrawals'],
  ['GET', '/payments/payout-methods'], ['POST', '/payments/payout-methods'], ['GET', '/payments/banks'],
  ['POST', '/auth/change-password'],
  ['GET', '/admin/settings'], ['POST', '/admin/settings'], ['GET', '/admin/withdrawals'],
  ['POST', `/admin/withdrawals/${ZERO}/approve`], ['POST', `/admin/withdrawals/${ZERO}/reject`],
  ['GET', '/intel/scan'], ['GET', '/intel/ideas'], ['GET', '/intel/performance'], ['GET', '/intel/asset/BTCUSD'],
];

test('every protected route refuses anonymous callers with 401', async () => {
  for (const [method, path] of PROTECTED) {
    const r = await call(method, path, { body: method === 'GET' ? undefined : {} });
    assert.equal(r.status, 401, `${method} ${path} -> ${r.status}`);
  }
});

test('admin routes refuse signed-in non-admins with 403', async () => {
  const u = await signUp();
  for (const [method, path] of PROTECTED.filter(([, p]) => p.startsWith('/admin'))) {
    const r = await call(method, path, { token: u.token, body: method === 'GET' ? undefined : { live_trading_enabled: true } });
    assert.equal(r.status, 403, `${method} ${path} -> ${r.status}`);
  }
  const s = await call('GET', '/me', { token: u.token });
  assert.equal(s.body.profile.is_admin, false, 'nobody becomes admin by calling admin routes');
});

test('forged and tampered tokens are refused', async () => {
  const u = await signUp();
  const [h, p] = u.token.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  const evil = Buffer.from(JSON.stringify({ ...claims, sub: ZERO })).toString('base64url');
  assert.equal((await call('GET', '/me', { token: `${h}.${evil}.${u.token.split('.')[2]}` })).status, 401, 'payload swap');
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  assert.equal((await call('GET', '/me', { token: `${none}.${p}.` })).status, 401, 'alg=none');
});

test('hostile and malformed input gets a clean 4xx, never a 500', async () => {
  const u = await signUp();
  const trade = (body) => call('POST', '/trades', { token: u.token, body: { accountId: u.demo.id, assetId: 'EURUSD', mode: 'fixed_time', direction: 'up', amount: 10, durationSec: 30, ...body } });
  const cases = [
    ['amount as string', trade({ amount: '10' })],
    ['negative amount', trade({ amount: -50 })],
    ['amount above balance', trade({ amount: 1e12 })],
    ['SQL in assetId', trade({ assetId: "EURUSD'; drop table trades;--" })],
    ['SQL in accountId', trade({ accountId: "' or 1=1 --" })],
    ['unknown mode', trade({ mode: 'free_money' })],
    ['fractional duration', trade({ durationSec: 30.5 })],
    ['leverage on forex above max', trade({ mode: 'forex', leverage: 100000, durationSec: undefined })],
    ['non-uuid trade id', call('GET', '/trades/not-a-uuid', { token: u.token })],
    ['non-uuid close', call('POST', '/trades/../../admin/settings/close', { token: u.token })],
    ['broken JSON', call('POST', '/trades', { token: u.token, body: '{"amount": 10,' })],
    ['body over 100kb', call('POST', '/trades', { token: u.token, body: JSON.stringify({ pad: 'x'.repeat(120_000) }) })],
    ['candles huge count', call('GET', '/candles/EURUSD?tf=5&count=1000000')],
    ['candles bad tf', call('GET', '/candles/EURUSD?tf=7')],
    ['unknown asset price', call('GET', '/price/%3Cscript%3E')],
    ['active account of another kind', call('PATCH', '/me', { token: u.token, body: { activeAccountId: 'nope' } })],
    ['register missing fields', call('POST', '/auth/register', { body: { email: 'x' } })],
    ['login with object injection', call('POST', '/auth/login', { body: { email: { $ne: null }, password: { $ne: null } } })],
  ];
  for (const [name, p] of cases) {
    const r = await p;
    assert.ok(r.status >= 400 && r.status < 500, `${name}: expected 4xx, got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  }
  assert.equal(Number((await call('GET', '/me', { token: u.token })).body.accounts.find((a) => a.type === 'DEMO').balance), 10000, 'no hostile call moved money');

  // List filters ignore values they do not understand and are always scoped to the caller.
  for (const qs of ['cursor=garbage', 'from=yesterday-ish', 'limit=-5', 'limit=99999', 'mode[]=x&status[]=y']) {
    const r = await call('GET', `/trades?${qs}`, { token: u.token });
    assert.equal(r.status, 200, `/trades?${qs} -> ${r.status}`);
    assert.ok(r.body.trades.every((t) => t.user_id === u.me.profile.id), 'only own trades');
  }

  // SQL in a filter is just a value (parameterised queries): it matches nothing.
  const inj = await call('GET', `/trades?assetId=${encodeURIComponent("x' OR '1'='1")}&status=closed`, { token: u.token });
  assert.ok(inj.status === 400 || (inj.status === 200 && inj.body.trades.length === 0), `SQL in filter -> ${inj.status}`);

  // Prototype pollution: extra keys are ignored, so this is just a valid trade and nobody becomes admin.
  const raw = '{"accountId":"' + u.demo.id + '","assetId":"EURUSD","mode":"fixed_time","direction":"up","amount":10,"durationSec":30,'
    + '"__proto__":{"is_admin":true},"constructor":{"prototype":{"is_admin":true}}}';
  assert.ok((await call('POST', '/trades', { token: u.token, body: raw })).status < 500, 'prototype keys do not crash the server');
  assert.equal((await call('GET', '/admin/settings', { token: u.token })).status, 403, 'prototype keys grant nothing');
});

test('stored text is returned as plain data and lists never leak other users', async () => {
  const u = await signUp();
  const v = await signUp();
  const xss = '<img src=x onerror=alert(1)>';
  assert.equal((await call('PATCH', '/me', { token: u.token, body: { fullName: xss } })).status, 200);
  assert.equal((await call('GET', '/me', { token: u.token })).body.profile.full_name, xss, 'stored as text, React renders it inert');
  await call('POST', '/trades', { token: v.token, body: { accountId: v.demo.id, assetId: 'EURUSD', mode: 'fixed_time', direction: 'up', amount: 10, durationSec: 30 } });
  const list = await call('GET', `/trades?accountId=${v.demo.id}`, { token: u.token });
  assert.ok(list.status === 400 || (list.status === 200 && list.body.trades.length === 0), 'another user\'s account id returns nothing');
});
