// The calls to Supabase Auth, against a small stand-in server. No network and no real project.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createUser, googleSignInUrl, passwordIsRight, sendReset, setPassword, userFromResetToken, userFromToken, usingSupabase } from '../src/supabaseAuth.js';

const seen = [];
const jwt = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
const RESET = jwt({ sub: 'u1', amr: [{ method: 'recovery' }] }), LOGIN = jwt({ sub: 'u1', amr: [{ method: 'password' }] });
let server;
before(async () => {
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : null;
    seen.push({ method: req.method, url: req.url, apikey: req.headers.apikey, auth: req.headers.authorization, body });
    const send = (status, out) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); };
    if (req.url === '/auth/v1/admin/users') return body.email === 'taken@x.test' ? send(422, { msg: 'exists' }) : body.email === 'broken@x.test' ? send(500, {}) : send(200, { id: 'new-id' });
    if (req.url.startsWith('/auth/v1/token')) return body.password === 'right-password' ? send(200, { access_token: 't' }) : send(400, { msg: 'invalid' });
    if (req.url === '/auth/v1/admin/users/u1') return send(200, {});
    if (req.url === '/auth/v1/user') return ['Bearer good-token', `Bearer ${RESET}`, `Bearer ${LOGIN}`].includes(req.headers.authorization) ? send(200, { id: 'u1', email: 'a@x.test' }) : send(401, {});
    if (req.url.startsWith('/auth/v1/recover')) return body.email === 'busy@x.test' ? send(429, {}) : send(200, {});
    return send(404, {});
  });
  await new Promise((r) => server.listen(0, r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}/`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
});
after(() => server.close());

test('it is off unless the server asks for it', () => {
  delete process.env.AUTH_PROVIDER;
  assert.equal(usingSupabase(), false);
  process.env.AUTH_PROVIDER = 'supabase';
  assert.equal(usingSupabase(), true);
  delete process.env.AUTH_PROVIDER;
});

test('sign-up returns the new id, null for a taken email, and throws on a server fault', async () => {
  assert.equal(await createUser({ email: 'a@x.test', password: 'p', fullName: 'A' }), 'new-id');
  const call = seen.at(-1);
  assert.equal(call.auth, 'Bearer service-key');
  assert.equal(call.body.email_confirm, true);
  assert.equal(call.body.user_metadata.full_name, 'A');
  assert.equal(await createUser({ email: 'taken@x.test', password: 'p', fullName: 'A' }), null);
  await assert.rejects(createUser({ email: 'broken@x.test', password: 'p', fullName: 'A' }));
});

test('a password is right only when Supabase says so', async () => {
  assert.equal(await passwordIsRight('a@x.test', 'right-password'), true);
  assert.equal(await passwordIsRight('a@x.test', 'wrong'), false);
});

test('the password changes for that user', async () => {
  await setPassword('u1', 'new-password');
  assert.equal(seen.at(-1).url, '/auth/v1/admin/users/u1');
  assert.equal(seen.at(-1).body.password, 'new-password');
});

test('a Google return is only trusted if Supabase recognises the token', async () => {
  assert.deepEqual(await userFromToken('good-token'), { id: 'u1', email: 'a@x.test' });
  assert.equal(await userFromToken('made-up'), null);
});

test('a reset email is asked for with the way back', async () => {
  await sendReset('a@x.test', 'https://app.example/reset');
  assert.match(seen.at(-1).url, /^\/auth\/v1\/recover\?redirect_to=https%3A%2F%2Fapp\.example%2Freset/);
  assert.equal(seen.at(-1).body.email, 'a@x.test');
  await assert.rejects(sendReset('busy@x.test', 'https://app.example/reset'), (e) => e.status === 429);
});

test('only a real reset token can change a password', async () => {
  assert.deepEqual(await userFromResetToken(RESET), { id: 'u1', email: 'a@x.test' });
  assert.equal(await userFromResetToken(LOGIN), null, 'an ordinary sign-in token is not enough');
  assert.equal(await userFromResetToken('nonsense'), null);
});

test('the Google address comes back to this site', () => {
  const u = new URL(googleSignInUrl('https://app.example/'));
  assert.equal(u.searchParams.get('provider'), 'google');
  assert.equal(u.searchParams.get('redirect_to'), 'https://app.example/');
});
