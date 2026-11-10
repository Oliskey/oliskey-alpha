// Admin-only: pending withdrawals and the live-trading switch. Mounted behind requireAuth + requireAdmin.
import { amountText, notify } from '../notify.js';
import { Router } from 'express';
import { pool } from '../db.js';
import { isUuid } from '../http.js';
import { paystack, paystackConfigured, toKobo } from '../paystack.js';

export const adminRouter = Router();

adminRouter.get('/withdrawals', async (req, res) => {
  const status = ['pending', 'completed', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const { rows } = await pool.query(
    `select t.id, t.amount, t.status, t.created_at, p.full_name, u.email,
            pm.bank_name, pm.account_number, pm.account_name
     from transactions t
     join profiles p on p.id = t.user_id join auth.users u on u.id = t.user_id
     left join payout_methods pm on pm.id = t.payout_method_id
     where t.type = 'withdrawal' and t.status = $1 order by t.created_at`, [status]);
  res.json(rows);
});

adminRouter.post('/withdrawals/:id/approve', async (req, res) => {
  if (!paystackConfigured()) return res.status(503).json({ error: 'Payments are not set up yet.' });
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Withdrawal not found.' });
  const { rows } = await pool.query(
    `select t.id, t.amount, t.status, t.metadata ->> 'payout' as payout, pm.id as pm_id, pm.recipient_code, pm.bank_code, pm.account_number, pm.account_name
     from transactions t join payout_methods pm on pm.id = t.payout_method_id
     where t.id = $1 and t.type = 'withdrawal'`, [req.params.id]);
  const w = rows[0];
  if (!w) return res.status(404).json({ error: 'Withdrawal not found.' });
  if (w.status !== 'pending') return res.status(400).json({ error: 'This withdrawal has already been handled.' });

  let recipient = w.recipient_code;
  if (!recipient) {
    const data = await paystack('POST', '/transferrecipient', {
      type: 'nuban', name: w.account_name, account_number: w.account_number, bank_code: w.bank_code, currency: 'NGN',
    });
    recipient = data.recipient_code;
    await pool.query('update payout_methods set recipient_code = $2 where id = $1', [w.pm_id, recipient]);
  }
  await paystack('POST', '/transfer', {
    // the bank gets the amount minus the withdrawal fee (fixed when the user asked; older requests have no fee)
    source: 'balance', amount: toKobo(w.payout != null ? Number(w.payout) : -Number(w.amount)), recipient, reference: `OAW-${w.id}`, reason: 'Oliskey Alpha withdrawal',
  });
  const done = await pool.query('select id, status from resolve_withdrawal($1, true, $2)', [w.id, req.user.id]);
  void notifyWithdrawal(w.id, true);
  res.json(done.rows[0]);
});

// Tell the owner how their withdrawal ended.
async function notifyWithdrawal(id, paid) {
  const { rows } = await pool.query('select user_id, amount from transactions where id = $1', [id]);
  if (!rows[0]) return;
  await notify(rows[0].user_id, 'transactions', paid ? 'Withdrawal sent' : 'Withdrawal declined',
    paid ? `${amountText('NGN', rows[0].amount)} is on its way to your bank.` : `${amountText('NGN', rows[0].amount)} is back in your account.`, '/withdraw');
}

adminRouter.post('/withdrawals/:id/reject', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Withdrawal not found.' });
  const { rows } = await pool.query('select id, status from resolve_withdrawal($1, false, $2, $3)',
    [req.params.id, req.user.id, String(req.body?.note ?? '') || null]);
  void notifyWithdrawal(req.params.id, false);
  res.json(rows[0]);
});

adminRouter.get('/settings', async (_req, res) => {
  res.json((await pool.query('select * from platform_settings where id')).rows[0]);
});

adminRouter.post('/settings', async (req, res) => {
  if (typeof req.body?.live_trading_enabled !== 'boolean') return res.status(400).json({ error: 'live_trading_enabled must be true or false.' });
  const { rows } = await pool.query(
    'update platform_settings set live_trading_enabled = $1, updated_at = now() where id returning *', [req.body.live_trading_enabled]);
  res.json(rows[0]);
});
