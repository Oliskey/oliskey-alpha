import { usingSupabase, passwordIsRight } from '../supabaseAuth.js';
// Profile, wallets, tasks, notifications, promo codes and ledger for the signed-in user.
import { Router } from 'express';
import { pool } from '../db.js';
import { isUuid } from '../http.js';
import { verifyPassword } from '../auth.js';

export const accountRouter = Router();

accountRouter.get('/me', async (req, res) => {
  const [profile, accounts, unread] = await Promise.all([
    pool.query(
      `select p.id, u.email, p.full_name, p.phone, p.tier, p.kyc_status, p.active_account_id, p.is_admin,
              exists (select 1 from admin_mfa m where m.user_id = p.id and m.enabled_at is not null) as mfa_enabled
       from profiles p join auth.users u on u.id = p.id where p.id = $1 and p.deleted_at is null`, [req.user.id]),
    pool.query(
      `select id, type, currency, balance, locked from accounts where user_id = $1
       order by array_position(array['DEMO','NGN','USDT']::account_type[], type)`, [req.user.id]),
    pool.query('select count(*)::int as n from notifications where user_id = $1 and read_at is null', [req.user.id]),
  ]);
  if (!profile.rows[0]) return res.status(401).json({ error: 'Please sign in again.' });
  res.json({ profile: profile.rows[0], accounts: accounts.rows, unreadNotifications: unread.rows[0].n });
});

// Delete account: password required; refused until real-money wallets are empty and no trade is open.
// Trades and ledger are kept; the person is anonymised (close_account in 007_close_account.sql).
accountRouter.delete('/me', async (req, res) => {
  const { rows } = await pool.query('select email, encrypted_password from auth.users where id = $1', [req.user.id]);
  const password = String(req.body?.password ?? '');
  const right = rows[0] && (usingSupabase() ? await passwordIsRight(rows[0].email, password) : await verifyPassword(password, rows[0].encrypted_password));
  if (!right) return res.status(400).json({ error: 'Password is incorrect.' });
  await pool.query('select close_account($1)', [req.user.id]);
  res.json({ ok: true });
});

accountRouter.patch('/me', async (req, res) => {
  const { fullName, phone, activeAccountId } = req.body ?? {};
  if (activeAccountId !== undefined) {
    const { rowCount } = await pool.query('select 1 from accounts where id = $1 and user_id = $2',
      [isUuid(activeAccountId) ? activeAccountId : null, req.user.id]);
    if (!rowCount) return res.status(400).json({ error: 'Account not found.' });
  }
  await pool.query(
    `update profiles set full_name = coalesce($2, full_name), phone = coalesce($3, phone),
            active_account_id = coalesce($4, active_account_id) where id = $1`,
    [req.user.id, fullName?.trim() || null, phone?.trim() || null, activeAccountId ?? null],
  );
  res.json({ ok: true });
});

accountRouter.post('/accounts/demo/reset', async (req, res) => {
  const { rows } = await pool.query('select id, balance from reset_demo($1)', [req.user.id]);
  res.json(rows[0]);
});

accountRouter.get('/transactions', async (req, res) => {
  const { rows } = await pool.query(
    `select id, account_id, type, status, amount, balance_after, reference, created_at
     from transactions where user_id = $1 and ($2::uuid is null or account_id = $2)
     order by created_at desc limit 50`,
    [req.user.id, isUuid(req.query.accountId) ? req.query.accountId : null],
  );
  res.json(rows);
});

accountRouter.get('/tasks', async (req, res) => {
  await pool.query(
    `update user_tasks set status = 'expired'
     where user_id = $1 and status = 'accepted' and expires_at <= now()`, [req.user.id]);
  const { rows } = await pool.query(
    `select t.id, t.title, t.kind, t.target, t.reward, t.asset_id, t.mode, t.time_limit_sec,
            ut.status, ut.progress, ut.expires_at
     from user_tasks ut join tasks t on t.id = ut.task_id
     where ut.user_id = $1 and t.is_active order by t.sort_order`, [req.user.id]);
  res.json(rows);
});

accountRouter.post('/tasks/:id/accept', async (req, res) => {
  const { rows } = await pool.query(
    `update user_tasks ut set status = 'accepted', progress = 0, accepted_at = now(), completed_at = null,
            expires_at = now() + make_interval(secs => t.time_limit_sec)
     from tasks t
     where t.id = ut.task_id and ut.user_id = $1 and ut.task_id = $2 and ut.status in ('available', 'expired')
     returning ut.status, ut.expires_at`, [req.user.id, req.params.id]);
  if (!rows[0]) return res.status(400).json({ error: 'This task cannot be accepted right now.' });
  res.json(rows[0]);
});

accountRouter.get('/notifications', async (req, res) => {
  const { rows } = await pool.query(
    `select id, category, title, body, link, read_at, created_at from notifications
     where user_id = $1 order by created_at desc limit 50`, [req.user.id]);
  res.json(rows);
});

accountRouter.post('/notifications/read', async (req, res) => {
  await pool.query('update notifications set read_at = now() where user_id = $1 and read_at is null', [req.user.id]);
  res.json({ ok: true });
});

accountRouter.get('/settings', async (_req, res) => {
  const { rows } = await pool.query(
    'select live_trading_enabled, demo_start_balance, min_deposit_ngn, min_withdrawal_ngn from platform_settings where id');
  res.json(rows[0]);
});

// Profitability Boosts: how many are waiting, and the running one.
accountRouter.get('/boosts', async (req, res) => {
  const { rows } = await pool.query(
    `select count(*) filter (where status = 'available')::int as available,
            max(expires_at) filter (where status = 'active' and expires_at > now()) as active_until
     from user_boosts where user_id = $1`, [req.user.id]);
  res.json(rows[0]);
});
accountRouter.post('/boosts/activate', async (req, res) => {
  const { rows } = await pool.query('select expires_at from activate_boost($1)', [req.user.id]);
  res.json({ active_until: rows[0].expires_at });
});

// Referral Program: your code and how your invites are doing. Nothing is paid here (see release_referral_bonuses).
accountRouter.get('/referrals', async (req, res) => {
  const [me, stats] = await Promise.all([
    pool.query('select referral_code from profiles where id = $1', [req.user.id]),
    pool.query(
      `select count(*)::int as invited,
              count(*) filter (where b.source_ref is not null)::int as traded,
              count(*) filter (where r.status = 'released')::int as released
       from referral_rewards r
       left join user_boosts b on b.user_id = r.referrer_id and b.source_ref = 'invite:' || r.invitee_id::text
       where r.referrer_id = $1`, [req.user.id]),
  ]);
  res.json({ code: me.rows[0].referral_code, ...stats.rows[0], bonus_usd: 100 });
});

// Rewards actually credited to this user: task rewards and promo bonuses, newest first.
accountRouter.get('/rewards', async (req, res) => {
  const { rows } = await pool.query(
    `select t.id, t.type, t.amount, t.created_at, a.type as account_type from transactions t join accounts a on a.id = t.account_id
     where t.user_id = $1 and t.type in ('bonus', 'task_reward') and t.status = 'completed' order by t.created_at desc limit 100`, [req.user.id]);
  res.json(rows);
});

accountRouter.get('/promo-codes', async (_req, res) => {
  const { rows } = await pool.query(
    `select code, description, bonus_pct, max_bonus, min_deposit from promo_codes
     where is_active and starts_at <= now() and (ends_at is null or ends_at > now())
       and (max_uses is null or uses < max_uses)`);
  res.json(rows);
});

// Funded programme (coming after licensing): record and read the user's interest.
accountRouter.get('/funded', async (req, res) => {
  const { rows } = await pool.query('select created_at from funded_interest where user_id = $1', [req.user.id]);
  res.json({ interested: !!rows[0], since: rows[0]?.created_at ?? null });
});

accountRouter.post('/funded/interest', async (req, res) => {
  await pool.query('insert into funded_interest (user_id) values ($1) on conflict do nothing', [req.user.id]);
  res.status(201).json({ interested: true });
});
