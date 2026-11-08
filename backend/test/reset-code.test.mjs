// The 6-digit reset code on the real route, with the local test database and a stand-in for Supabase Auth.
// Right code: password saved, signed in. Wrong code: refused; after 5 wrong codes that email waits. Old reset links still work.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import 'dotenv/config';

const jwt = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
let gotrue, server, api, pool, userId, newPassword = null;
const email = `code${Date.now()}@test.local`, locked = `lock${Date.now()}@test.local`;

before(async () => {
  gotrue = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/auth/v1/verify') return body.email === email && body.token === '654321' ? send(200, { user: { id: userId, email } }) : send(403, {});
    if (req.url === '/auth/v1/user') return req.headers.authorization === `Bearer ${jwt({ sub: userId, amr: [{ method: 'recovery' }] })}` ? send(200, { id: userId, email }) : send(401, {});
    if (req.url === `/auth/v1/admin/users/${userId}`) { newPassword = body.password; return send(200, {}); }
    send(404, {});
  });
  await new Promise((r) => gotrue.listen(0, r));
  Object.assign(process.env, {
    AUTH_PROVIDER: 'supabase', SUPABASE_URL: `http://127.0.0.1:${gotrue.address().port}`, SUPABASE_SERVICE_ROLE_KEY: 'k',
    DATABASE_URL: process.env.DATABASE_URL.replace(/\/oliskey_alpha(\?|$)/, '/oliskey_alpha_test$1'), AUTH_RATE_LIMIT: '1000',
  });
  ({ pool } = await import('../src/db.js'));
  ({ rows: [{ id: userId }] } = await pool.query(`insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, '', '{"full_name":"Code Test"}') returning id`, [email]));
  const { default: express } = await import('express');
  const { authRouter } = await import('../src/routes/auth.js');
  const { errorHandler } = await import('../src/http.js');
  const app = express(); app.use(express.json()); app.use('/auth', authRouter); app.use(errorHandler);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  api = async (body) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/auth/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
});
after(async () => { server?.close(); gotrue.close(); await pool?.query('delete from auth.users where email in ($1, $2)', [email, locked]); await pool?.end(); });

test('the right code saves the new password and signs in', async () => {
  const r = await api({ email, code: '654321', password: 'brand-new-pass' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.token, 'signed in');
  assert.equal(newPassword, 'brand-new-pass');
});

test('a wrong, short or missing code is refused, and the password stays', async () => {
  newPassword = null;
  assert.equal((await api({ email, code: '111111', password: 'another-pass' })).status, 401);
  assert.equal((await api({ email, code: '12345', password: 'another-pass' })).status, 400);
  assert.equal((await api({ email: 'not-an-email', code: '654321', password: 'another-pass' })).status, 400);
  assert.equal((await api({ email, code: '654321', password: 'short' })).status, 400);
  assert.equal(newPassword, null);
});

test('after 5 wrong codes the email waits, even for the right code', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await api({ email: locked, code: '000000', password: 'another-pass' })).status, 401);
  assert.equal((await api({ email: locked, code: '000000', password: 'another-pass' })).status, 429);
});

test('a reset link from an older email still works', async () => {
  const r = await api({ accessToken: jwt({ sub: userId, amr: [{ method: 'recovery' }] }), password: 'link-pass-123' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(newPassword, 'link-pass-123');
});
