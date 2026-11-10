// Auth: HS256 JWTs signed with SUPABASE_JWT_SECRET, the same token format Supabase Auth issues.
// Locally the backend issues them itself (register/login); on hosted Supabase only verification is used.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
import { pool } from './db.js';

const scrypt = promisify(scryptCb);
const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET || '');
if (secret.length < 32) throw new Error('SUPABASE_JWT_SECRET must be at least 32 characters');

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [kind, salt, hash] = (stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

// Session token. Admin sessions that passed the 2-step code carry amr ["pwd","otp"] and last 12 hours.
export function signToken(user, { mfa = false } = {}) {
  return new SignJWT({ role: 'authenticated', email: user.email, ...(mfa && { amr: ['pwd', 'otp'] }) })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(mfa ? '12h' : '7d')
    .sign(secret);
}

// Short-lived ticket between the password step and the code step of an admin login. Not a session:
// verifyToken only accepts role "authenticated".
export function signMfaTicket(user) {
  return new SignJWT({ role: 'mfa_pending', email: user.email })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secret);
}

export async function verifyMfaTicket(token) {
  try {
    const { payload } = await jwtVerify(String(token ?? ''), secret, { algorithms: ['HS256'] });
    return payload.role === 'mfa_pending' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

// A real scrypt hash of a random password: login compares against it for unknown emails,
// so "no such user" takes as long as "wrong password" and emails can't be probed by timing.
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));

// Returns { id, mfa } for a valid session token, or null.
export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    return payload.role === 'authenticated' && payload.sub
      ? { id: payload.sub, mfa: Array.isArray(payload.amr) && payload.amr.includes('otp') } : null;
  } catch {
    return null;
  }
}

// A deleted account's sessions stop working. Checked on every request with a 30-second cache per user, so the check
// costs about one indexed query per user per 30 s; forgetUser() makes a deletion take effect at once on this server.
const status = new Map();   // user id -> { active, at }
export async function isActiveUser(id) {
  const hit = status.get(id);
  if (hit && Date.now() - hit.at < 30_000) return hit.active;
  const { rows } = await pool.query('select deleted_at from profiles where id = $1', [id]);
  const active = !rows[0]?.deleted_at;
  if (status.size > 50_000) status.clear();
  status.set(id, { active, at: Date.now() });
  return active;
}
export const forgetUser = (id) => status.delete(id);

export async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const user = header.startsWith('Bearer ') ? await verifyToken(header.slice(7)) : null;
  if (!user || !(await isActiveUser(user.id))) return res.status(401).json({ error: 'Please sign in again.' });
  req.user = user;
  next();
}

export async function requireAdmin(req, res, next) {
  const { rows } = await pool.query('select is_admin from profiles where id = $1', [req.user.id]);
  if (!rows[0]?.is_admin) return res.status(403).json({ error: 'Admins only.' });
  if (!req.user.mfa) {
    return res.status(403).json({ error: 'Admin tools need 2-step login. Set it up on your Profile, then log in again with your code.', code: 'ADMIN_2FA_REQUIRED' });
  }
  next();
}
