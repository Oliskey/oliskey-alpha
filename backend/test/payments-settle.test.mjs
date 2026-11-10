// Deposit settlement under failure: concurrent webhook + verify + sweep, lost webhooks, wrong amounts, unknown references.
// Uses the real database (DATABASE_URL) and a running backend for sign-up; Paystack is replaced by a stand-in `verify`.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/db.js';
import { reconcileDeposits, settleDeposit } from '../src/routes/payments.js';

const API = process.env.API_URL || 'http://localhost:3311';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
after(() => pool.end());

async function ngnAccount() {
  const email = `pay${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.local`;
  const reg = await (await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'Pay Test', email, password: 'password123' }) })).json();
  const me = await (await fetch(`${API}/me`, { headers: { authorization: `Bearer ${reg.token}` } })).json();
  return { userId: me.profile.id, account: me.accounts.find((a) => a.type === 'NGN').id };
}

async function pendingDeposit({ userId, account }, amount, { promo = null, minutesAgo = 0 } = {}) {
  const reference = `OA-test-${randomUUID()}`;
  await pool.query(
    `insert into transactions (user_id, account_id, type, status, amount, reference, metadata, created_at)
     values ($1, $2, 'deposit', 'pending', $3, $4, $5, now() - make_interval(mins => $6))`,
    [userId, account, amount, reference, promo ? { promo_code: promo } : {}, minutesAgo]);
  return reference;
}

const balance = async (account) => Number((await pool.query('select balance from accounts where id = $1', [account])).rows[0].balance);
const status = async (reference) => (await pool.query('select status, metadata from transactions where reference = $1', [reference])).rows[0];
const paid = (amount, extra = {}) => async () => { await sleep(20); return { status: 'success', currency: 'NGN', amount: Math.round(amount * 100), ...extra }; };

test('webhook, verify and sweep racing: credited exactly once, bonus once, one notice, nobody gets an error', async () => {
  const who = await ngnAccount();
  const code = `T${Date.now()}`;
  await pool.query(`insert into promo_codes (code, description, bonus_pct, max_bonus, min_deposit) values ($1, 'test', 10, 1000, 1000)`, [code]);
  const ref = await pendingDeposit(who, 5000, { promo: code });
  const before = await balance(who.account);
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => settleDeposit(ref, { verify: paid(5000) })));
  // Hide the test code again at once: other test files share this database and count the public promo list.
  await pool.query(`update promo_codes set is_active = false where code = $1`, [code]);
  assert.deepEqual(results.map((r) => r.status), Array(6).fill('fulfilled'), JSON.stringify(results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message)));
  assert.equal(await balance(who.account) - before, 5500, 'deposit 5,000 + 10% bonus 500, once');
  assert.equal((await status(ref)).status, 'completed');
  await sleep(200);
  const notices = (await pool.query(`select count(*)::int as n from notifications where user_id = $1 and title = 'Deposit received'`, [who.userId])).rows[0].n;
  assert.equal(notices, 1, 'one "Deposit received" notice');
  const bonuses = (await pool.query(`select count(*)::int as n from transactions where reference = $1`, [`promo:${code}:${who.userId}`])).rows[0].n;
  assert.equal(bonuses, 1);
  assert.equal((await settleDeposit(ref, { verify: paid(5000) })).status, 'completed', 'a late duplicate webhook changes nothing');
  assert.equal(await balance(who.account) - before, 5500);
});

test('wrong amount from Paystack: never credited, held for review, skipped by the sweep', async () => {
  const who = await ngnAccount();
  const ref = await pendingDeposit(who, 5000, { minutesAgo: 10 });
  const before = await balance(who.account);
  await assert.rejects(settleDeposit(ref, { verify: paid(500) }), /AMOUNT_MISMATCH/);
  const s = await status(ref);
  assert.equal(s.status, 'pending');
  assert.equal(s.metadata.review, 'amount_mismatch');
  assert.equal(Number(s.metadata.paid_kobo), 50000);
  assert.equal(await balance(who.account), before);
  let asked = false;
  await reconcileDeposits({ verify: async (r) => { if (r === ref) asked = true; throw new Error('not found'); }, minAgeMin: 5 });
  assert.equal(asked, false, 'held deposits are left for a person');
});

test('lost webhook (database was down): the sweep credits the deposit once, later sweeps do nothing', async () => {
  const who = await ngnAccount();
  const ref = await pendingDeposit(who, 2000, { minutesAgo: 10 });
  const fresh = await pendingDeposit(who, 3000, { minutesAgo: 1 });
  const before = await balance(who.account);
  const verify = async (r) => (r === ref ? paid(2000)() : { status: 'abandoned' });
  await reconcileDeposits({ verify });
  assert.equal((await status(ref)).status, 'completed');
  assert.equal(await balance(who.account) - before, 2000);
  assert.equal((await status(fresh)).status, 'pending', 'a deposit under 5 minutes old is left for the webhook');
  await reconcileDeposits({ verify });
  assert.equal(await balance(who.account) - before, 2000, 'credited once');
});

test('failed or abandoned at Paystack: marked failed, nothing credited; unknown references fail only after an hour', async () => {
  const who = await ngnAccount();
  const failed = await pendingDeposit(who, 1000, { minutesAgo: 10 });
  const unknownNew = await pendingDeposit(who, 1000, { minutesAgo: 10 });
  const unknownOld = await pendingDeposit(who, 1000, { minutesAgo: 90 });
  const before = await balance(who.account);
  const verify = async (r) => {
    if (r === failed) return { status: 'failed' };
    if (r === unknownNew || r === unknownOld) throw new Error('Paystack /transaction/verify: Transaction reference not found');
    return { status: 'abandoned' };
  };
  await reconcileDeposits({ verify, log: { error() {} } });
  assert.equal((await status(failed)).status, 'failed');
  assert.equal((await status(unknownNew)).status, 'pending', 'Paystack may not know it yet');
  assert.equal((await status(unknownOld)).status, 'failed');
  assert.equal((await status(unknownOld)).metadata.reason, 'unknown_to_paystack');
  assert.equal(await balance(who.account), before);
});
