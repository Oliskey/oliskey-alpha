import { notify } from '../notify.js';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { pool } from '../db.js';
import { DUMMY_HASH, hashPassword, requireAuth, signMfaTicket, signToken, verifyMfaTicket, verifyPassword } from '../auth.js';
import { newSecret, otpauthUrl, verifyCode } from '../totp.js';
import { createUser, googleSignInUrl, passwordIsRight, sendReset, setPassword, usingSupabase, userFromResetToken, userFromToken } from '../supabaseAuth.js';

export const authRouter = Router();
// Sign-up / login / code attempts per IP per 15 minutes. Tests and CI raise it (they create many users).
authRouter.use(rateLimit({ windowMs: 15 * 60_000, limit: Number(process.env.AUTH_RATE_LIMIT || 30), standardHeaders: 'draft-8', legacyHeaders: false }));

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Admins are made only with `npm run db:admin -- <email>` (never at sign-up: emails are not verified,
// so auto-promoting an email would let whoever registers it first become admin).

authRouter.post('/register', async (req, res) => {
  const fullName = String(req.body?.fullName ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (fullName.length < 2) return res.status(400).json({ error: 'Enter your full name.' });
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  try {
    let rows;
    if (usingSupabase()) {
      const id = await createUser({ email, password, fullName });
      if (!id) return res.status(409).json({ error: 'An account with this email already exists.' });
      rows = [{ id, email }];
    } else {
      ({ rows } = await pool.query(
        `insert into auth.users (email, encrypted_password, raw_user_meta_data)
         values ($1, $2, jsonb_build_object('full_name', $3::text)) returning id, email`,
        [email, await hashPassword(password), fullName],
      ));
    }
    const inviteCode = typeof req.body?.inviteCode === 'string' ? req.body.inviteCode.slice(0, 16) : '';
    if (inviteCode) await pool.query('select set_referrer($1, $2)', [rows[0].id, inviteCode]);
    void notify(rows[0].id, 'platform', 'Welcome to Oliskey Alpha', 'Your demo account has α10,000 to practise with. No real money is involved.', '/terminal');
    res.status(201).json({ token: await signToken(rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An account with this email already exists.' });
    throw err;
  }
});

authRouter.post('/login', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const { rows } = await pool.query(
    `select u.id, u.email, u.encrypted_password, p.is_admin,
            exists (select 1 from admin_mfa m where m.user_id = u.id and m.enabled_at is not null) as mfa
     from auth.users u left join profiles p on p.id = u.id where u.email = $1`, [email]);
  const ok = usingSupabase() ? rows[0] && await passwordIsRight(email, password) : await verifyPassword(password, rows[0]?.encrypted_password ?? DUMMY_HASH);
  if (!rows[0] || !ok) return res.status(401).json({ error: 'Email or password is incorrect.' });
  await sendSession(res, rows[0]);
});

// Admins with 2-step login enabled get a 5-minute ticket and must send their code next.
async function sendSession(res, user) {
  if (user.is_admin && user.mfa) return res.json({ mfaRequired: true, mfaTicket: await signMfaTicket(user) });
  res.json({ token: await signToken(user) });
}

// What the sign-in screens can offer. Google is on only when the server is told it has been set up.
authRouter.get('/config', (req, res) => {
  const on = usingSupabase() && process.env.GOOGLE_SIGNIN === 'on';
  // back to the site the person started on, only if it is one of ours
  const own = `${req.protocol}://${req.get('host')}`;
  const from = String(req.query.from ?? '');
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
  res.json({ googleUrl: on ? googleSignInUrl(`${allowed.includes(from) ? from : own}/`) : null });
});

// Back from Google: Supabase gave the browser a token. It is only trusted once Supabase confirms whose it is.
authRouter.post('/oauth', async (req, res) => {
  if (!usingSupabase()) return res.status(404).json({ error: 'Not available.' });
  const who = await userFromToken(String(req.body?.accessToken ?? ''));
  if (!who) return res.status(401).json({ error: 'Google sign-in did not complete. Please try again.' });
  const { rows } = await pool.query(
    `select u.id, u.email, p.is_admin, exists (select 1 from admin_mfa m where m.user_id = u.id and m.enabled_at is not null) as mfa
     from auth.users u left join profiles p on p.id = u.id where u.id = $1`, [who.id]);
  if (!rows[0]) return res.status(401).json({ error: 'Google sign-in did not complete. Please try again.' });
  await sendSession(res, rows[0]);
});

authRouter.post('/login/mfa', async (req, res) => {
  const userId = await verifyMfaTicket(req.body?.mfaTicket);
  if (!userId) return res.status(401).json({ error: 'Your login timed out. Enter your email and password again.' });
  const user = await checkCode(userId, req.body?.code, true);
  if (!user) return res.status(401).json({ error: 'That code is not correct. Use the newest code from your authenticator app.' });
  res.json({ token: await signToken(user, { mfa: true }) });
});

// 2-step login setup for admins: create a secret (shown once as text + otpauth link), then confirm one code.
authRouter.post('/mfa/setup', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `select u.email, p.is_admin, m.enabled_at from auth.users u join profiles p on p.id = u.id
     left join admin_mfa m on m.user_id = u.id where u.id = $1`, [req.user.id]);
  if (!rows[0]?.is_admin) return res.status(403).json({ error: 'Admins only.' });
  if (rows[0].enabled_at) return res.status(409).json({ error: '2-step login is already on.' });
  const secret = newSecret();
  await pool.query(
    `insert into admin_mfa (user_id, secret) values ($1, $2)
     on conflict (user_id) do update set secret = excluded.secret, last_used_step = 0`, [req.user.id, secret]);
  res.json({ secret, otpauthUrl: otpauthUrl(secret, rows[0].email) });
});

authRouter.post('/mfa/enable', requireAuth, async (req, res) => {
  const user = await checkCode(req.user.id, req.body?.code, false);
  if (!user) return res.status(400).json({ error: 'That code is not correct. Check the time on your phone and try the newest code.' });
  await pool.query('update admin_mfa set enabled_at = now() where user_id = $1', [req.user.id]);
  res.json({ token: await signToken(user, { mfa: true }) });
});

// Verifies a code against the user's secret (enabled or still being set up) and burns its step.
async function checkCode(userId, code, mustBeEnabled) {
  const { rows } = await pool.query(
    `select u.id, u.email, m.secret, m.enabled_at, m.last_used_step from admin_mfa m join auth.users u on u.id = m.user_id
     where m.user_id = $1`, [userId]);
  const m = rows[0];
  if (!m || (mustBeEnabled && !m.enabled_at)) return null;
  const step = verifyCode(m.secret, code, Number(m.last_used_step));
  if (step === null) return null;
  const used = await pool.query(
    'update admin_mfa set last_used_step = $2 where user_id = $1 and last_used_step < $2 returning 1', [userId, step]);
  return used.rowCount ? { id: m.id, email: m.email } : null;
}

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const current = String(req.body?.currentPassword ?? '');
  const next = String(req.body?.newPassword ?? '');
  if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const { rows } = await pool.query('select email, encrypted_password from auth.users where id = $1', [req.user.id]);
  const right = rows[0] && (usingSupabase() ? await passwordIsRight(rows[0].email, current) : await verifyPassword(current, rows[0].encrypted_password));
  if (!right) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (usingSupabase()) await setPassword(req.user.id, next);
  else await pool.query('update auth.users set encrypted_password = $2 where id = $1', [req.user.id, await hashPassword(next)]);
  res.json({ ok: true });
});

// The back address for links in emails and Google: the site the person is on, only if it is one of ours.
function siteOf(req) {
  const from = String(req.body?.from ?? req.query.from ?? '');
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
  return allowed.includes(from) ? from : `${req.protocol}://${req.get('host')}`;
}

// Forgot password: Supabase emails a link to /reset. The answer is the same whether or not the email has an account.
authRouter.post('/forgot', async (req, res) => {
  if (!usingSupabase()) return res.status(501).json({ error: 'Password reset by email is not available here. Contact support to reset your password.' });
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  try { await sendReset(email, `${siteOf(req)}/reset`); } catch (err) { if (err.status === 429) return res.status(429).json({ error: err.message }); throw err; }
  res.json({ ok: true });
});

// The new password from the reset page. Only a fresh reset token from Supabase is accepted, and it signs the person in.
authRouter.post('/reset', async (req, res) => {
  if (!usingSupabase()) return res.status(404).json({ error: 'Not available.' });
  const password = String(req.body?.password ?? '');
  if (password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters.' });
  const who = await userFromResetToken(String(req.body?.accessToken ?? ''));
  if (!who) return res.status(401).json({ error: 'This reset link is not valid or has expired. Ask for a new one.' });
  await setPassword(who.id, password);
  const { rows } = await pool.query(
    `select u.id, u.email, p.is_admin, exists (select 1 from admin_mfa m where m.user_id = u.id and m.enabled_at is not null) as mfa
     from auth.users u left join profiles p on p.id = u.id where u.id = $1`, [who.id]);
  if (!rows[0]) return res.status(401).json({ error: 'This reset link is not valid or has expired. Ask for a new one.' });
  await sendSession(res, rows[0]);
});
