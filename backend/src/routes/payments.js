// Real-money flows (Paystack NGN). Every entry point refuses while platform_settings.live_trading_enabled is false.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { pool } from '../db.js';
import { amountText, notify } from '../notify.js';
import { isUuid } from '../http.js';
import { paystack, paystackConfigured, toKobo, validSignature } from '../paystack.js';

const COMING_SOON = 'Real-money trading is coming soon.';

async function liveEnabled() {
  const { rows } = await pool.query('select live_trading_enabled, min_deposit_ngn from platform_settings where id');
  return rows[0];
}

// Verifies a deposit with Paystack and credits it (plus any promo bonus). Safe to call repeatedly and concurrently:
// the webhook, the customer's "verify" and the reconciliation sweep may all race; exactly one of them credits.
// `verify` is injectable for tests; in production it asks Paystack.
const paystackVerify = (reference) => paystack('GET', `/transaction/verify/${encodeURIComponent(reference)}`);

export async function settleDeposit(reference, { verify = paystackVerify } = {}) {
  const { rows } = await pool.query(
    "select * from transactions where reference = $1 and type = 'deposit'", [reference]);
  const tx = rows[0];
  if (!tx || tx.status !== 'pending') return tx;

  const data = await verify(reference);            // network call: never made while holding a database lock
  if (data.status !== 'success') {
    if (['failed', 'abandoned', 'reversed'].includes(data.status)) {
      await pool.query("update transactions set status = 'failed' where id = $1 and status = 'pending'", [tx.id]);
    }
    return { ...tx, status: data.status };
  }
  if (data.currency !== 'NGN' || data.amount !== toKobo(tx.amount)) {
    // Money may have moved, but not what was asked for: never credit automatically, flag it for a person instead.
    await pool.query(
      `update transactions set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('review', 'amount_mismatch',
         'paid_kobo', $2::bigint, 'paid_currency', $3::text) where id = $1 and status = 'pending'`,
      [tx.id, Number(data.amount) || 0, String(data.currency ?? '')]);
    console.error(`deposit ${reference}: Paystack amount/currency differs; held for review`);
    throw new Error('AMOUNT_MISMATCH');
  }

  // One transaction, row locked: the deposit and its promo bonus are credited together, by exactly one caller.
  const client = await pool.connect();
  let credited, bonus = null;
  try {
    await client.query('begin');
    const now = (await client.query('select * from transactions where id = $1 for update', [tx.id])).rows[0];
    if (now.status !== 'pending') { await client.query('commit'); return now; }   // another caller credited it first
    credited = (await client.query('select * from credit_deposit($1, $2)', [reference, tx.amount])).rows[0];
    const code = tx.metadata?.promo_code;
    if (code) {
      const promo = (await client.query('select * from promo_codes where code = $1', [code])).rows[0];
      if (promo && Number(tx.amount) >= Number(promo.min_deposit)) {
        const amount = Math.min(Number(tx.amount) * Number(promo.bonus_pct) / 100, Number(promo.max_bonus));
        await client.query('savepoint promo');
        try {
          await client.query("select credit_bonus($1, $2, 'bonus', $3, $4)",
            [tx.account_id, amount.toFixed(2), `promo:${code}:${tx.user_id}`, code]);
          bonus = { code, amount };
        } catch (err) {
          if (err.message !== 'PROMO_UNAVAILABLE') throw err;
          await client.query('rollback to savepoint promo');   // the deposit still counts without the bonus
        }
      }
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
  void notify(tx.user_id, 'transactions', 'Deposit received', `${amountText('NGN', tx.amount)} has been added to your account.`, '/history');
  if (bonus) void notify(tx.user_id, 'rewards', 'Bonus added', `${amountText('NGN', bonus.amount)} from promo code ${bonus.code}.`, '/rewards');
  // a friend's real deposit can complete an inviter's referral bonus (does nothing unless live trading is on)
  void pool.query('select release_referral_bonuses()').catch((err) => console.error('referral release', err.message));
  return credited;
}

// Reconciliation: a deposit Paystack confirmed can stay pending if the webhook was lost or arrived while the database
// was down, and the customer never came back. Every few minutes the leader re-checks pending deposits with Paystack.
// A reference Paystack has never heard of after an hour cannot have been paid, so it is marked failed.
export async function reconcileDeposits({ verify = paystackVerify, minAgeMin = 5, maxAgeHours = 72, limit = 50, log = console } = {}) {
  const { rows } = await pool.query(
    `select reference, created_at from transactions
     where type = 'deposit' and status = 'pending' and coalesce(metadata->>'review', '') = ''
       and created_at < now() - make_interval(mins => $1) and created_at > now() - make_interval(hours => $2)
     order by created_at limit $3`, [minAgeMin, maxAgeHours, limit]);
  const out = { checked: rows.length, credited: 0, failed: 0, errors: 0 };
  for (const { reference, created_at: at } of rows) {
    try {
      const tx = await settleDeposit(reference, { verify });
      if (tx?.status === 'completed') out.credited++;
      else if (['failed', 'abandoned', 'reversed'].includes(tx?.status)) out.failed++;
    } catch (err) {
      if (/not found/i.test(err.message) && Date.now() - new Date(at).getTime() > 3_600_000) {
        await pool.query(
          `update transactions set status = 'failed', metadata = coalesce(metadata, '{}'::jsonb) || '{"reason":"unknown_to_paystack"}'
           where reference = $1 and status = 'pending'`, [reference]);
        out.failed++;
      } else {
        out.errors++;
        log.error('deposit reconcile', reference, err.message);
      }
    }
  }
  return out;
}

export const paymentsRouter = Router();

paymentsRouter.post('/payments/deposit', async (req, res) => {
  const settings = await liveEnabled();
  if (!settings.live_trading_enabled) return res.status(403).json({ error: COMING_SOON, code: 'LIVE_TRADING_DISABLED' });
  if (!paystackConfigured()) return res.status(503).json({ error: 'Payments are not set up yet.' });

  const { accountId, amount, promoCode } = req.body ?? {};
  const { rows: acc } = await pool.query(
    `select a.id, u.email from accounts a join auth.users u on u.id = a.user_id
     where a.id = $1 and a.user_id = $2 and a.type = 'NGN'`, [isUuid(accountId) ? accountId : null, req.user.id]);
  if (!acc[0]) return res.status(400).json({ error: 'Choose your NGN account.' });
  if (typeof amount !== 'number' || amount < Number(settings.min_deposit_ngn) || amount !== Math.round(amount * 100) / 100) {
    return res.status(400).json({ error: `The minimum deposit is ₦${Number(settings.min_deposit_ngn).toLocaleString()}.` });
  }
  if (promoCode) {
    const { rows } = await pool.query(
      `select min_deposit from promo_codes where code = $1 and is_active and starts_at <= now()
         and (ends_at is null or ends_at > now()) and (max_uses is null or uses < max_uses)`, [promoCode]);
    if (!rows[0]) return res.status(400).json({ error: 'This promo code is not available.' });
    if (amount < Number(rows[0].min_deposit)) return res.status(400).json({ error: `This code needs a deposit of at least ₦${Number(rows[0].min_deposit).toLocaleString()}.` });
  }

  const reference = `OA-${randomUUID()}`;
  await pool.query(
    `insert into transactions (user_id, account_id, type, status, amount, reference, metadata)
     values ($1, $2, 'deposit', 'pending', $3, $4, $5)`,
    [req.user.id, acc[0].id, amount, reference, promoCode ? { promo_code: promoCode } : {}]);
  const data = await paystack('POST', '/transaction/initialize', {
    email: acc[0].email, amount: toKobo(amount), currency: 'NGN', reference,
    callback_url: process.env.PAYSTACK_CALLBACK_URL || undefined,
    metadata: { user_id: req.user.id, account_id: acc[0].id },
  });
  res.status(201).json({ reference, authorizationUrl: data.authorization_url });
});

// POST /payments/paystack/webhook — called by Paystack, so mounted without requireAuth. Reply 200 quickly, then process.
// If processing fails here (database down), the reconciliation sweep credits it later: a 200 never loses a deposit.
export function paystackWebhook(req, res) {
  if (!validSignature(req.rawBody, req.get('x-paystack-signature'))) return res.status(401).end();
  res.sendStatus(200);
  if (req.body?.event === 'charge.success' && req.body.data?.reference) {
    settleDeposit(req.body.data.reference).catch((err) => console.error('webhook', err.message));
  }
}

paymentsRouter.get('/payments/verify/:reference', async (req, res) => {
  const { rows } = await pool.query(
    "select status from transactions where reference = $1 and user_id = $2 and type = 'deposit'",
    [req.params.reference, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Deposit not found.' });
  if (rows[0].status !== 'pending' || !paystackConfigured()) return res.json({ status: rows[0].status });
  const tx = await settleDeposit(req.params.reference);
  res.json({ status: tx.status });
});

paymentsRouter.get('/payments/banks', async (_req, res) => {
  if (!paystackConfigured()) return res.status(503).json({ error: 'Payments are not set up yet.' });
  const banks = await paystack('GET', '/bank?country=nigeria&currency=NGN');
  res.json(banks.map((b) => ({ name: b.name, code: b.code })));
});

paymentsRouter.get('/payments/payout-methods', async (req, res) => {
  const { rows } = await pool.query(
    `select id, kind, bank_name, account_number, account_name, is_default from payout_methods
     where user_id = $1 order by created_at`, [req.user.id]);
  res.json(rows);
});

paymentsRouter.post('/payments/payout-methods', async (req, res) => {
  if (!paystackConfigured()) return res.status(503).json({ error: 'Payments are not set up yet.' });
  const { bankCode, bankName, accountNumber } = req.body ?? {};
  if (!/^\d{10}$/.test(String(accountNumber ?? ''))) return res.status(400).json({ error: 'Enter a 10-digit account number.' });
  if (!/^\d{3,6}$/.test(String(bankCode ?? ''))) return res.status(400).json({ error: 'Choose a bank.' });
  const data = await paystack('GET', `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
  const { rows } = await pool.query(
    `insert into payout_methods (user_id, kind, bank_code, bank_name, account_number, account_name)
     values ($1, 'bank', $2, $3, $4, $5) returning id, kind, bank_name, account_number, account_name`,
    [req.user.id, bankCode, String(bankName ?? ''), accountNumber, data.account_name]);
  res.status(201).json(rows[0]);
});

paymentsRouter.post('/payments/withdraw', async (req, res) => {
  const { accountId, amount, payoutMethodId } = req.body ?? {};
  if (!isUuid(accountId) || !isUuid(payoutMethodId)) return res.status(400).json({ error: 'Choose an account and a bank account.' });
  if (typeof amount !== 'number') return res.status(400).json({ error: 'Enter an amount.' });
  const { rows } = await pool.query('select id, status, amount, created_at from request_withdrawal($1, $2, $3, $4)',
    [req.user.id, accountId, amount, payoutMethodId]);
  void notify(req.user.id, 'transactions', 'Withdrawal requested', `${amountText('NGN', amount)} is under review. We will tell you when it is done.`, '/withdraw');
  res.status(201).json(rows[0]);
});

paymentsRouter.get('/payments/withdrawals', async (req, res) => {
  const { rows } = await pool.query(
    `select id, status, amount, created_at, completed_at from transactions
     where user_id = $1 and type = 'withdrawal' order by created_at desc limit 50`, [req.user.id]);
  res.json(rows);
});
