// Alerts that reach people when the app is closed (the Web Push standard: browsers and installed web apps).
// With no keys configured this stays off and nothing else changes. A delivery failure is only logged.
import { Router } from 'express';
import webpush from 'web-push';
import { pool } from './db.js';

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const enabled = !!(PUBLIC_KEY && PRIVATE_KEY);
if (enabled) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://oliskey-alpha.vercel.app', PUBLIC_KEY, PRIVATE_KEY);

const MAX_DEVICES = 5;
// The server sends to this address, so only real browser push services are accepted (never an address of the caller's choice).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^[a-z0-9.-]+\.push\.apple\.com$/, /^[a-z0-9.-]+\.notify\.windows\.com$/, /^[a-z0-9.-]+\.services\.mozilla\.com$/];

export function validEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.port && !u.username && !u.password && PUSH_HOSTS.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
}

export async function sendPush(userId, { title, body, link }) {
  if (!enabled) return;
  const { rows } = await pool.query(
    `select s.endpoint, s.p256dh, s.auth from push_subscriptions s join profiles p on p.id = s.user_id
     where s.user_id = $1 and p.deleted_at is null`, [userId]);
  const payload = JSON.stringify({ title, body, link });
  await Promise.all(rows.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' });
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) await pool.query('delete from push_subscriptions where endpoint = $1', [s.endpoint]);
      else console.error('push', err.statusCode ?? err.message);
    }
  }));
}

export const pushRouter = Router();

pushRouter.get('/push/key', (_req, res) => {
  if (!enabled) return res.status(503).json({ error: 'Alerts are not set up on this server yet.' });
  res.json({ key: PUBLIC_KEY });
});

pushRouter.post('/push/subscribe', async (req, res) => {
  if (!enabled) return res.status(503).json({ error: 'Alerts are not set up on this server yet.' });
  const { endpoint, keys } = req.body?.subscription ?? {};
  const short = (v) => typeof v === 'string' && v.length > 0 && v.length < 300;
  if (!validEndpoint(endpoint) || !short(keys?.p256dh) || !short(keys?.auth)) return res.status(400).json({ error: 'This browser sent an alert address that cannot be used.' });
  const { rows } = await pool.query('select count(*)::int as n from push_subscriptions where user_id = $1 and endpoint <> $2', [req.user.id, endpoint]);
  if (rows[0].n >= MAX_DEVICES) return res.status(400).json({ error: `Alerts can be on for up to ${MAX_DEVICES} devices. Turn them off on another one first.` });
  await pool.query(
    `insert into push_subscriptions (endpoint, user_id, p256dh, auth) values ($1, $2, $3, $4)
     on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    [endpoint, req.user.id, keys.p256dh, keys.auth]);
  res.status(201).json({ ok: true });
});

pushRouter.post('/push/unsubscribe', async (req, res) => {
  await pool.query('delete from push_subscriptions where endpoint = $1 and user_id = $2', [String(req.body?.endpoint ?? ''), req.user.id]);
  res.json({ ok: true });
});
