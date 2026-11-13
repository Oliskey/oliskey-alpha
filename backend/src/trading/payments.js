// Payments for Oliskey AI Trading: strategy subscriptions and 15% commission invoices, through Paystack (Stripe can be
// added behind the same functions). Nothing is marked paid on the app's word: Paystack is asked directly
// (/transaction/verify), the amount and currency must match exactly, and the database allows one success per invoice.
// Every successful payment is booked in Oliskey's double-entry ledger in the same transaction.
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { paystack, paystackConfigured } from '../paystack.js';
import { D, mul, round, str } from './decimal.js';
import { subscriptionPrice } from './money.js';
import { usdNgnRate } from './fxRate.js';

export const SUB_PREFIX = 'OAT-S-', COM_PREFIX = 'OAT-C-';

/** NGN for a USD amount at checkout. The rate is read online from two sources that must agree (fxRate.js); never guessed. */
export async function usdToNgn(usd, opts) {
  const { rate } = await usdNgnRate(opts);
  return { amount: str(round(mul(usd, rate), 2, 'half_up'), 2), rate };
}

const kobo = (ngn) => Number(D(ngn) / 1_000_000n);   // 8-decimal fixed point → kobo (2 decimals)

async function checkout({ email, reference, ngn, metadata }) {
  if (!paystackConfigured()) throw Object.assign(new Error('PAYMENTS_NOT_CONFIGURED'), { status: 503 });
  const data = await paystack('POST', '/transaction/initialize', {
    email, amount: kobo(ngn), currency: 'NGN', reference,
    callback_url: process.env.PAYSTACK_CALLBACK_URL || undefined, metadata,
  });
  return data.authorization_url;
}

/** Start a subscription checkout for 1-4 strategies (one payment). Subscriptions stay "pending_payment" until verified. */
export async function startSubscriptionCheckout({ userId, email, strategyIds, client = pool }) {
  const usd = subscriptionPrice(strategyIds);
  const { amount, rate } = await usdToNgn(usd);
  const reference = SUB_PREFIX + randomUUID();
  const db = await client.connect();
  try {
    await db.query('begin');
    const { rows: known } = await db.query('select id from trading.trading_strategies where id = any($1) and active', [strategyIds]);
    if (known.length !== strategyIds.length) throw Object.assign(new Error('UNKNOWN_STRATEGY'), { status: 400 });
    const { rows: [pay] } = await db.query(
      `insert into trading.subscription_payments (user_id, provider, reference, strategies, amount_usd, amount, currency, fx_rate)
       values ($1, 'paystack', $2, $3, $4, $5, 'NGN', $6) returning id`, [userId, reference, strategyIds, usd, amount, rate]);
    for (const s of strategyIds) {
      // re-use a pending row for the same strategy; an active one is renewed by the payment
      await db.query(
        `insert into trading.strategy_subscriptions (user_id, strategy_id, status, payment_id) values ($1, $2, 'pending_payment', $3)
         on conflict (user_id, strategy_id) where status in ('pending_payment', 'active', 'past_due')
         do update set payment_id = excluded.payment_id, updated_at = now()`, [userId, s, pay.id]);
    }
    await db.query('commit');
    const url = await checkout({ email, reference, ngn: amount, metadata: { kind: 'ai_trading_subscription', user_id: userId } });
    return { reference, amountUsd: usd, amountNgn: amount, fxRate: rate, authorizationUrl: url };
  } catch (e) { await db.query('rollback').catch(() => {}); throw e; } finally { db.release(); }
}

/** Start paying a commission invoice. */
export async function startCommissionCheckout({ userId, email, invoiceId, client = pool }) {
  const { rows: [inv] } = await client.query('select * from trading.commission_invoices where id = $1 and user_id = $2', [invoiceId, userId]);
  if (!inv) throw Object.assign(new Error('INVOICE_NOT_FOUND'), { status: 404 });
  if (inv.status !== 'issued') throw Object.assign(new Error('INVOICE_NOT_PAYABLE'), { status: 409 });
  const { amount, rate } = await usdToNgn(inv.commission);
  const reference = COM_PREFIX + randomUUID();
  await client.query(`insert into trading.commission_payments (invoice_id, provider, reference, amount, currency, fx_rate)
    values ($1, 'paystack', $2, $3, 'NGN', $4)`, [inv.id, reference, amount, rate]);
  const url = await checkout({ email, reference, ngn: amount, metadata: { kind: 'ai_trading_commission', invoice: inv.number } });
  return { reference, invoice: inv.number, amountUsd: inv.commission, amountNgn: amount, fxRate: rate, authorizationUrl: url };
}

const paystackVerify = async (reference) => paystack('GET', `/transaction/verify/${encodeURIComponent(reference)}`);

/**
 * Settles a subscription or commission payment after asking Paystack. Safe to call many times and concurrently
 * (webhook, the customer's return, a reconciliation sweep): the row is locked and only a pending row changes.
 */
export async function settleTradingPayment(reference, { verify = paystackVerify, client = pool, now = new Date() } = {}) {
  const isSub = reference.startsWith(SUB_PREFIX), isCom = reference.startsWith(COM_PREFIX);
  if (!isSub && !isCom) return { status: 'ignored' };
  const table = isSub ? 'trading.subscription_payments' : 'trading.commission_payments';
  const { rows: [pre] } = await client.query(`select status from ${table} where reference = $1`, [reference]);
  if (!pre) return { status: 'unknown_reference' };
  if (pre.status !== 'pending') return { status: pre.status };
  const tx = await verify(reference);
  const db = await client.connect();
  try {
    await db.query('begin');
    const { rows: [p] } = await db.query(`select * from ${table} where reference = $1 for update`, [reference]);
    if (p.status !== 'pending') { await db.query('rollback'); return { status: p.status }; }
    const paid = tx?.status === 'success' && tx.currency === p.currency && Number(tx.amount) === kobo(p.amount) && tx.reference === reference;
    if (!paid) {
      if (tx?.status === 'failed' || tx?.status === 'abandoned' || (tx?.status === 'success' && !paid)) {
        await db.query(`update ${table} set status = 'failed' where id = $1`, [p.id]);
        await db.query(`insert into trading.system_events (kind, severity, message, details) values ('payment', $1, $2, $3)`,
          [tx?.status === 'success' ? 'critical' : 'info', tx?.status === 'success' ? 'Paid amount does not match the checkout' : 'Payment not completed', { reference, provider_status: tx?.status }]);
      }
      await db.query('commit');
      return { status: tx?.status === 'success' ? 'amount_mismatch' : 'not_paid' };
    }
    await db.query(`update ${table} set status = 'success', verified_at = $2 where id = $1`, [p.id, now]);
    const entry = randomUUID();
    if (isSub) {
      const end = new Date(now.getTime() + 30 * 86_400_000);
      await db.query(
        `update trading.strategy_subscriptions s set status = 'active',
           current_period_start = case when s.status = 'active' and s.current_period_end > $3 then s.current_period_start else $3 end,
           current_period_end = case when s.status = 'active' and s.current_period_end > $3 then s.current_period_end + interval '30 days' else $4 end,
           updated_at = now()
         where s.user_id = $1 and s.strategy_id = any($2) and s.status in ('pending_payment', 'active', 'past_due')`,
        [p.user_id, p.strategies, now, end]);
      await db.query(
        `insert into trading.account_ledger (entry_id, account, debit, credit, currency, memo, ref_type, ref_id) values
         ($1, 'cash_paystack', $2, 0, 'NGN', $3, 'subscription_payment', $4), ($1, 'revenue_subscriptions', 0, $2, 'NGN', $3, 'subscription_payment', $4)`,
        [entry, p.amount, `Subscription ${p.strategies.join(', ')}`, p.id]);
    } else {
      await db.query(`update trading.commission_invoices set status = 'paid', paid_at = $2 where id = $1 and status = 'issued'`, [p.invoice_id, now]);
      await db.query(
        `insert into trading.account_ledger (entry_id, account, debit, credit, currency, memo, ref_type, ref_id) values
         ($1, 'cash_paystack', $2, 0, 'NGN', 'Commission payment', 'commission_payment', $3), ($1, 'revenue_commission', 0, $2, 'NGN', 'Commission payment', 'commission_payment', $3)`,
        [entry, p.amount, p.id]);
    }
    await db.query('commit');
    return { status: 'success' };
  } catch (e) { await db.query('rollback').catch(() => {}); throw e; } finally { db.release(); }
}
