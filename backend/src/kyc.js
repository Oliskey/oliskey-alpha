// Identity check before withdrawals: Paystack matches the user's BVN, bank account and legal name
// (https://paystack.com/docs/identity-verification/validate-customer/). The answer arrives by webhook
// (customeridentification.success / .failed) and is confirmed by asking Paystack directly; a sweep covers lost webhooks.
// The BVN is sent to Paystack and never stored or logged here (migration 019).
import { Router } from 'express';
import { pool } from './db.js';
import { notify } from './notify.js';
import { paystack, paystackConfigured } from './paystack.js';

const MAX_TRIES_PER_DAY = 3;
const NAME = /^[A-Za-z][A-Za-z' -]{1,49}$/;

export const kycRouter = Router();

const current = async (userId) => {
  const { rows: [p] } = await pool.query('select kyc_status from profiles where id = $1', [userId]);
  const { rows: [last] } = await pool.query(
    `select status, reason, created_at from kyc_checks where user_id = $1 order by created_at desc limit 1`, [userId]).catch(() => ({ rows: [] }));
  return { status: p?.kyc_status ?? 'none', reason: p?.kyc_status === 'rejected' ? last?.reason ?? null : null, submittedAt: last?.created_at ?? null };
};

kycRouter.get('/kyc', async (req, res) => res.json(await current(req.user.id)));

kycRouter.post('/kyc', async (req, res) => {
  const { firstName, lastName, bvn, bankCode, accountNumber } = req.body ?? {};
  const first = String(firstName ?? '').trim();
  const last = String(lastName ?? '').trim();
  if (!NAME.test(first) || !NAME.test(last)) return res.status(400).json({ error: 'Enter your first and last name as they appear on your BVN.' });
  if (!/^\d{11}$/.test(String(bvn ?? ''))) return res.status(400).json({ error: 'Your BVN has 11 digits.' });
  if (!/^\d{10}$/.test(String(accountNumber ?? ''))) return res.status(400).json({ error: 'Enter a 10-digit account number.' });
  if (!/^\d{3,6}$/.test(String(bankCode ?? ''))) return res.status(400).json({ error: 'Choose a bank.' });

  const now = await current(req.user.id);
  if (now.status === 'verified') return res.status(409).json({ error: 'Your identity is already verified.' });
  if (now.status === 'pending') return res.status(409).json({ error: 'Your last check is still running. We will tell you when it is done.' });
  const { rows: [{ n }] } = await pool.query(
    `select count(*)::int as n from kyc_checks where user_id = $1 and created_at > now() - interval '1 day'`, [req.user.id]);
  if (n >= MAX_TRIES_PER_DAY) return res.status(429).json({ error: 'Too many tries today. Please try again tomorrow.' });
  if (!paystackConfigured()) return res.status(503).json({ error: 'Identity checks are not set up yet.' });

  const { rows: [u] } = await pool.query('select email from auth.users where id = $1', [req.user.id]);
  let customer;
  try {
    customer = await paystack('POST', '/customer', { email: u.email, first_name: first, last_name: last });
    await paystack('POST', `/customer/${encodeURIComponent(customer.customer_code)}/identification`, {
      country: 'NG', type: 'bank_account', account_number: String(accountNumber), bvn: String(bvn), bank_code: String(bankCode),
      first_name: first, last_name: last,
    });
  } catch (err) {
    console.error('kyc submit', err.message.replace(/\d{11}/g, '***'));   // never log a BVN
    return res.status(502).json({ error: 'We could not reach the bank check. Please try again in a few minutes.' });
  }
  await pool.query(
    `insert into kyc_checks (user_id, customer_code, first_name, last_name, bank_code, account_last4) values ($1, $2, $3, $4, $5, $6)`,
    [req.user.id, customer.customer_code, first, last, String(bankCode), String(accountNumber).slice(-4)]);
  await pool.query(`update profiles set kyc_status = 'pending' where id = $1 and kyc_status <> 'verified'`, [req.user.id]);
  res.status(202).json(await current(req.user.id));
});

const isIdentified = async (code) => Boolean((await paystack('GET', `/customer/${encodeURIComponent(code)}`))?.identified);

// Settles the pending check for this Paystack customer. `identified` asks Paystack (a webhook alone is not trusted).
export async function decideKyc(customerCode, { failedReason = null, identified = isIdentified } = {}) {
  const ok = await identified(customerCode);
  if (!ok && failedReason === null) return null;   // still running
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows: [check] } = await client.query(
      `select id, user_id from kyc_checks where customer_code = $1 and status = 'pending' order by created_at desc limit 1 for update`, [customerCode]);
    if (!check) { await client.query('rollback'); return null; }
    await client.query(`update kyc_checks set status = $2, reason = $3, decided_at = now() where id = $1`,
      [check.id, ok ? 'verified' : 'failed', ok ? null : failedReason]);
    await client.query(`update profiles set kyc_status = $2 where id = $1 and kyc_status <> 'verified'`, [check.user_id, ok ? 'verified' : 'rejected']);
    await client.query('commit');
    void notify(check.user_id, 'transactions', ok ? 'Identity verified' : 'Identity check failed',
      ok ? 'You can now withdraw to your bank.' : `${failedReason} You can try again.`, '/withdraw');
    return { userId: check.user_id, status: ok ? 'verified' : 'failed' };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const friendly = (reason) => {
  const r = String(reason ?? '').toLowerCase();
  if (r.includes('name')) return 'The name did not match your BVN.';
  if (r.includes('account')) return 'The bank account did not match your BVN.';
  return 'Your details did not match your BVN.';
};

// From the Paystack webhook (signature already checked).
export function kycEvent(event, data) {
  const code = data?.customer_code;
  if (!code) return null;
  if (event === 'customeridentification.success') return decideKyc(code);
  if (event === 'customeridentification.failed') return decideKyc(code, { failedReason: friendly(data.reason) });
  return null;
}

// Lost webhooks: checks still pending after 2 minutes are asked again; after a day without an answer they fail.
export async function reconcileKyc({ identified = isIdentified } = {}) {
  const { rows } = await pool.query(
    `select distinct customer_code, min(created_at) as at from kyc_checks
     where status = 'pending' and created_at < now() - interval '2 minutes' group by customer_code limit 50`);
  const out = [];
  for (const r of rows) {
    const old = Date.now() - new Date(r.at).getTime() > 24 * 3600_000;
    out.push(await decideKyc(r.customer_code, { identified, failedReason: old ? 'The bank check did not answer.' : null }).catch((err) => {
      console.error('kyc reconcile', err.message);
      return null;
    }));
  }
  return out.filter(Boolean);
}
