// The calls to Supabase Auth, against a small stand-in server. No network and no real project.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createUser, googleSignInUrl, passwordIsRight, setPassword, userFromToken, usingSupabase } from '../src/supabaseAuth.js';

const seen = [];
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
    if (req.url === '/auth/v1/user') return req.headers.authorization === 'Bearer good-token' ? send(200, { id: 'u1', email: 'a@x.test' }) : send(401, {});
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

test('the Google address comes back to this site', () => {
  const u = new URL(googleSignInUrl('https://app.example/'));
  assert.equal(u.searchParams.get('provider'), 'google');
  assert.equal(u.searchParams.get('redirect_to'), 'https://app.example/');
});
