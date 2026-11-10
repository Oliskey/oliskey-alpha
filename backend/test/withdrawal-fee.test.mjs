// Withdrawal fee shown to the app, and money returned when a bank transfer fails after approval.
// The fee arithmetic itself is tested in supabase/tests/007_withdrawal_fee.sql.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { returnFailedTransfer } from '../src/routes/payments.js';

const API = process.env.API_URL || 'http://localhost:3311';
after(() => pool.end());

async function signUp() {
  const r = await fetch(API + '/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'Fee Test', email: `fee${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.local`, password: 'password123' }),
  });
  return (await r.json()).token;
}

async function approvedWithdrawal() {
  const token = await signUp();
  const me = await (await fetch(API + '/me', { headers: { authorization: `Bearer ${token}` } })).json();
  const ngn = me.accounts.find((a) => a.type === 'NGN');
  me.id = (await pool.query('select user_id from accounts where id = $1', [ngn.id])).rows[0].user_id;
  // an approved 4,000 withdrawal (600 fee, 3,400 to the bank), as resolve_withdrawal leaves it: 6,000 left of 10,000
  const { rows: [tx] } = await pool.query(
    `insert into transactions (user_id, account_id, type, status, amount, balance_after, completed_at, metadata)
     values ($1, $2, 'withdrawal', 'completed', -4000, 6000, now(), '{"fee": 600, "fee_pct": 15, "payout": 3400}') returning id`, [me.id, ngn.id]);
  await pool.query(`insert into transactions (user_id, account_id, type, status, amount, balance_after, completed_at, reference)
     values ($1, $2, 'deposit', 'completed', 10000, 10000, now(), $3)`, [me.id, ngn.id, `fee-dep-${tx.id}`]);
  await pool.query('update accounts set balance = 6000 where id = $1', [ngn.id]);
  await pool.query(`insert into platform_revenue (transaction_id, kind, currency, amount) values ($1, 'withdrawal_fee', 'NGN', 600)`, [tx.id]);
  return { id: tx.id, account: ngn.id, userId: me.id };
}
const balance = async (id) => Number((await pool.query('select balance from accounts where id = $1', [id])).rows[0].balance);

test('the app is told the withdrawal fee rate', async () => {
  const token = await signUp();
  const s = await (await fetch(API + '/settings', { headers: { authorization: `Bearer ${token}` } })).json();
  assert.equal(Number(s.withdrawal_fee_pct), 15);
  assert.equal(typeof s.live_trading_enabled, 'boolean');
  assert.ok(Number(s.min_withdrawal_ngn) > 0);
});

test('a failed bank transfer returns the whole amount once and cancels the fee', async () => {
  const w = await approvedWithdrawal();
  const results = await Promise.all(Array.from({ length: 3 }, () => returnFailedTransfer(`OAW-${w.id}`, { status: async () => 'failed' })));
  assert.ok(results.every((r) => r.status === 'failed'));
  assert.equal(await balance(w.account), 10000, 'back to 10,000, once');
  const rev = (await pool.query('select reversed_at from platform_revenue where transaction_id = $1', [w.id])).rows[0];
  assert.ok(rev.reversed_at, 'fee revenue cancelled');
  const ledger = (await pool.query(`select a.balance + a.locked = coalesce((select sum(amount) from transactions t where t.account_id = a.id and t.status = 'completed'), 0) as ok
    from accounts a where a.id = $1`, [w.account])).rows[0].ok;
  assert.ok(ledger, 'ledger still matches');
});

test('a webhook alone is not trusted: if Paystack says the transfer succeeded, nothing changes', async () => {
  const w = await approvedWithdrawal();
  assert.equal(await returnFailedTransfer(`OAW-${w.id}`, { status: async () => 'success' }), null);
  assert.equal(await balance(w.account), 6000);
  assert.equal(await returnFailedTransfer('not-ours', { status: async () => 'failed' }), null, 'other references ignored');
});
