// Identity check before withdrawals (Paystack BVN + bank account match). Paystack itself is replaced by stubs here;
// the BVN must never be stored.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { decideKyc, reconcileKyc } from '../src/kyc.js';

const API = process.env.API_URL || 'http://localhost:3311';
after(() => pool.end());

async function call(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function user() {
  const { body: { token } } = await call('POST', '/auth/register', { body: { fullName: 'Kyc Test', email: `kyc${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.local`, password: 'password123' } });
  const me = (await call('GET', '/me', { token })).body;
  const id = (await pool.query('select user_id from accounts where id = $1', [me.accounts[0].id])).rows[0].user_id;
  return { token, id };
}
// a check Paystack has accepted and is still running (what POST /kyc leaves behind)
async function pendingCheck(u, { hoursAgo = 0 } = {}) {
  const code = `CUS_test${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  await pool.query(`insert into kyc_checks (user_id, customer_code, first_name, last_name, bank_code, account_last4, created_at)
    values ($1, $2, 'Ada', 'Obi', '058', '6789', now() - make_interval(hours => $3))`, [u.id, code, hoursAgo]);
  await pool.query(`update profiles set kyc_status = 'pending' where id = $1`, [u.id]);
  return code;
}
const yes = async () => true;
const no = async () => false;
const good = { firstName: 'Ada', lastName: 'Obi', bvn: '12345678901', bankCode: '058', accountNumber: '0123456789' };

test('the check needs a login, and a new user starts unverified', async () => {
  assert.equal((await call('GET', '/kyc')).status, 401);
  assert.equal((await call('POST', '/kyc', { body: good })).status, 401);
  const u = await user();
  assert.equal((await call('GET', '/kyc', { token: u.token })).body.status, 'none');
});

test('bad details are refused before anything is sent; without Paystack set up nothing starts', async () => {
  const u = await user();
  for (const bad of [{ ...good, bvn: '123' }, { ...good, bvn: '1234567890a' }, { ...good, accountNumber: '12' }, { ...good, bankCode: 'x' },
    { ...good, firstName: '' }, { ...good, lastName: '1<script>' }, {}]) {
    assert.equal((await call('POST', '/kyc', { token: u.token, body: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call('POST', '/kyc', { token: u.token, body: good })).status, 503);
  assert.equal((await call('GET', '/kyc', { token: u.token })).body.status, 'none');
  assert.equal((await pool.query('select count(*)::int as n from kyc_checks where user_id = $1', [u.id])).rows[0].n, 0);
});

test('the BVN is never stored', async () => {
  const { rows } = await pool.query(`select column_name from information_schema.columns where table_name = 'kyc_checks'`);
  assert.ok(rows.length > 0);
  assert.ok(!rows.some((r) => /bvn/i.test(r.column_name)), rows.map((r) => r.column_name).join(','));
});

test('a match confirmed by Paystack verifies the user, once', async () => {
  const u = await user();
  const code = await pendingCheck(u);
  assert.equal((await call('GET', '/kyc', { token: u.token })).body.status, 'pending');
  const [a, b] = await Promise.all([decideKyc(code, { identified: yes }), decideKyc(code, { identified: yes })]);
  assert.equal([a, b].filter(Boolean).length, 1, 'decided once even when webhook and sweep race');
  assert.equal((await call('GET', '/kyc', { token: u.token })).body.status, 'verified');
  await new Promise((r) => setTimeout(r, 200));
  const notices = (await pool.query(`select count(*)::int as n from notifications where user_id = $1 and title = 'Identity verified'`, [u.id])).rows[0].n;
  assert.equal(notices, 1, 'one notice');
  assert.equal((await call('POST', '/kyc', { token: u.token, body: good })).status, 409, 'already verified');
});

test('a failed match is shown with a plain reason and can be tried again; a later failure never undoes a verified user', async () => {
  const u = await user();
  const code = await pendingCheck(u);
  await decideKyc(code, { identified: no, failedReason: 'The name did not match your BVN.' });
  const k = (await call('GET', '/kyc', { token: u.token })).body;
  assert.equal(k.status, 'rejected');
  assert.equal(k.reason, 'The name did not match your BVN.');

  const v = await user();
  const c2 = await pendingCheck(v);
  await decideKyc(c2, { identified: yes });
  const c3 = `CUS_late${Date.now()}`;
  await pool.query(`insert into kyc_checks (user_id, customer_code, first_name, last_name, bank_code, account_last4) values ($1, $2, 'A', 'B', '058', '1111')`, [v.id, c3]);
  await decideKyc(c3, { identified: no, failedReason: 'x' });
  assert.equal((await call('GET', '/kyc', { token: v.token })).body.status, 'verified');
});

test('a webhook alone is not trusted, and the sweep settles lost answers', async () => {
  const u = await user();
  const code = await pendingCheck(u, { hoursAgo: 1 });
  assert.equal(await decideKyc(code, { identified: no }), null, '"success" claimed but Paystack says not identified: still pending');
  assert.equal((await call('GET', '/kyc', { token: u.token })).body.status, 'pending');

  const settled = await reconcileKyc({ identified: async (c) => c === code });
  assert.ok(settled.some((s) => s.userId === u.id && s.status === 'verified'));

  const old = await user();
  await pendingCheck(old, { hoursAgo: 30 });
  await reconcileKyc({ identified: no });
  assert.equal((await call('GET', '/kyc', { token: old.token })).body.status, 'rejected', 'no answer after a day: fails so the user can retry');
});

test('withdrawals stay closed until the identity is verified', async () => {
  const u = await user();
  const { rows: [acc] } = await pool.query(`select id from accounts where user_id = $1 and type = 'NGN'`, [u.id]);
  const { rows: [pm] } = await pool.query(`insert into payout_methods (user_id, kind, bank_code, account_number) values ($1, 'bank', '058', '0123456789') returning id`, [u.id]);
  const r = await call('POST', '/payments/withdraw', { token: u.token, body: { accountId: acc.id, amount: 1000, payoutMethodId: pm.id } });
  assert.ok(r.status >= 400 && r.status < 500, String(r.status));
});
