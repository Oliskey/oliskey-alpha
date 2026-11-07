// Admin 2-step login (TOTP) against a running backend. Makes a fresh user admin directly in the database,
// the same thing `npm run db:admin` does.
import '../src/env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { base32Encode, codeAt, verifyCode } from '../src/totp.js';

const API = process.env.API_URL || 'http://localhost:3311';
after(() => pool.end());

async function call(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('TOTP matches the RFC 6238 test vectors and refuses reuse', () => {
  const s = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(codeAt(s, Math.floor(59 / 30), 8), '94287082');
  assert.equal(codeAt(s, Math.floor(1111111109 / 30), 8), '07081804');
  assert.equal(codeAt(s, Math.floor(1234567890 / 30), 8), '89005924');
  const now = 1_700_000_000_000;
  const step = Math.floor(now / 30000);
  assert.equal(verifyCode(s, codeAt(s, step), 0, now), step);
  assert.equal(verifyCode(s, codeAt(s, step), step, now), null, 'same step cannot be used twice');
  assert.equal(verifyCode(s, codeAt(s, step - 5), 0, now), null, 'old codes expire');
  assert.equal(verifyCode(s, 'abcdef', 0, now), null);
});

test('admin tools need 2-step login; codes work once; the ticket is not a session', async () => {
  const email = `adm${Date.now()}@test.local`;
  const reg = await call('POST', '/auth/register', { body: { fullName: 'Admin Test', email, password: 'password123' } });
  const me = await call('GET', '/me', { token: reg.body.token });
  assert.equal(me.body.profile.is_admin, false, 'nobody is admin at sign-up');
  await pool.query('update profiles set is_admin = true where id = $1', [me.body.profile.id]);

  const blocked = await call('GET', '/admin/settings', { token: reg.body.token });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'ADMIN_2FA_REQUIRED');

  const setup = await call('POST', '/auth/mfa/setup', { token: reg.body.token });
  assert.equal(setup.status, 200);
  assert.match(setup.body.otpauthUrl, /^otpauth:\/\/totp\//);
  const step = () => Math.floor(Date.now() / 30000);
  assert.equal((await call('POST', '/auth/mfa/enable', { token: reg.body.token, body: { code: '000000' } })).status, 400);
  const enabled = await call('POST', '/auth/mfa/enable', { token: reg.body.token, body: { code: codeAt(setup.body.secret, step()) } });
  assert.equal(enabled.status, 200);
  assert.equal((await call('GET', '/admin/settings', { token: enabled.body.token })).status, 200, 'mfa session opens admin tools');
  assert.equal((await call('POST', '/auth/mfa/setup', { token: enabled.body.token })).status, 409, 'cannot silently replace the secret');

  const login = await call('POST', '/auth/login', { body: { email, password: 'password123' } });
  assert.equal(login.body.mfaRequired, true);
  assert.equal(login.body.token, undefined, 'no session before the code');
  assert.equal((await call('GET', '/me', { token: login.body.mfaTicket })).status, 401, 'ticket is not a session');

  const next = codeAt(setup.body.secret, step() + 1);   // the next step is inside the drift window
  assert.equal((await call('POST', '/auth/login/mfa', { body: { mfaTicket: login.body.mfaTicket, code: '123456' } })).status, 401);
  const ok = await call('POST', '/auth/login/mfa', { body: { mfaTicket: login.body.mfaTicket, code: next } });
  assert.equal(ok.status, 200);
  assert.equal((await call('GET', '/admin/settings', { token: ok.body.token })).status, 200);
  assert.equal((await call('POST', '/auth/login/mfa', { body: { mfaTicket: login.body.mfaTicket, code: next } })).status, 401, 'a code works once');

  assert.equal((await call('POST', '/auth/mfa/setup', { token: reg.body.token })).status, 409);
  const plain = await call('POST', '/auth/register', { body: { fullName: 'Plain User', email: `pl${Date.now()}@test.local`, password: 'password123' } });
  assert.equal((await call('POST', '/auth/mfa/setup', { token: plain.body.token })).status, 403, 'only admins can set it up');
});
