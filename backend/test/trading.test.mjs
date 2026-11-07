// End-to-end trading tests against a running backend (signs up fresh users each run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import WebSocket from 'ws';

const API = process.env.API_URL || 'http://localhost:3311';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function signUp() {
  const email = `t${Date.now()}${Math.random().toString(36).slice(2, 7)}@test.local`;
  const r = await call('POST', '/auth/register', { body: { fullName: 'Test User', email, password: 'password123' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const me = await call('GET', '/me', { token: r.body.token });
  return { email, token: r.body.token, me: me.body, demo: me.body.accounts.find((a) => a.type === 'DEMO') };
}

const balance = async (u) => Number((await call('GET', '/me', { token: u.token })).body.accounts.find((a) => a.type === 'DEMO').balance);

test('auth: register, login, bad password, protected routes', async () => {
  const u = await signUp();
  assert.equal(u.me.profile.full_name, 'Test User');
  assert.equal(u.me.accounts.length, 3);
  assert.equal(Number(u.demo.balance), 10000);
  assert.equal(u.me.profile.active_account_id, u.demo.id);
  assert.equal((await call('POST', '/auth/login', { body: { email: u.email, password: 'password123' } })).status, 200);
  assert.equal((await call('POST', '/auth/login', { body: { email: u.email, password: 'wrong-pass' } })).status, 401);
  assert.equal((await call('POST', '/auth/register', { body: { fullName: 'X Y', email: u.email, password: 'password123' } })).status, 409);
  assert.equal((await call('GET', '/me')).status, 401);
  assert.equal((await call('GET', '/me', { token: 'not-a-token' })).status, 401);
});

test('fixed time: 20 trades settle on the server and the balance matches the ledger', async () => {
  const u = await signUp();
  const ws = new WebSocket(API.replace('http', 'ws') + '/stream');
  await new Promise((r) => ws.once('open', r));
  const pushed = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'trade_closed') pushed.push(m.trade.id); });
  ws.send(JSON.stringify({ type: 'auth', token: u.token }));

  const opened = await Promise.all(Array.from({ length: 20 }, (_, i) => call('POST', '/trades', {
    token: u.token,
    body: { accountId: u.demo.id, assetId: 'EURUSD', mode: 'fixed_time', direction: i % 2 ? 'up' : 'down', amount: 100, durationSec: 5 },
  })));
  for (const o of opened) assert.equal(o.status, 201, JSON.stringify(o.body));
  assert.equal(await balance(u), 8000, 'stakes debited');

  await sleep(6500);
  const { body } = await call('GET', '/trades?status=closed&limit=50', { token: u.token });
  assert.equal(body.trades.length, 20, 'all 20 settled');
  let expected = 8000;
  for (const t of body.trades) {
    const open = Number(t.open_quote), close = Number(t.close_quote);
    const want = close === open ? 'refund' : (close > open) === (t.direction === 'up') ? 'win' : 'loss';
    assert.equal(t.result, want, 'result follows the quotes');
    assert.equal(Number(t.return_amount), { win: 185, loss: 0, refund: 100 }[want]);
    expected += Number(t.return_amount);
  }
  assert.equal(await balance(u), expected, 'balance = stakes back + payouts');
  ws.close();
  assert.equal(pushed.length, 20, 'trade_closed pushed to the owner for every trade');

  const detail = await call('GET', `/trades/${body.trades[0].id}`, { token: u.token });
  assert.ok(detail.body.ticks.length >= 15, 'quote ticks saved for Quotes History');
});

test('two trades at once can never overspend', async () => {
  const u = await signUp();
  const results = await Promise.all(Array.from({ length: 20 }, () => call('POST', '/trades', {
    token: u.token, body: { accountId: u.demo.id, assetId: 'GBPUSD', mode: 'fixed_time', direction: 'up', amount: 600, durationSec: 60 },
  })));
  assert.equal(results.filter((r) => r.status === 201).length, 16, '16 x 600 fit in 10,000');
  assert.ok(results.filter((r) => r.status === 400).every((r) => r.body.code === 'INSUFFICIENT_FUNDS'));
  assert.equal(await balance(u), 400);
});

test('the day and week totals are the settled trades, added up by the server', async () => {
  const u = await signUp();
  const open = async (amount) => (await call('POST', '/trades', { token: u.token, body: { accountId: u.demo.id, assetId: 'EURUSD', mode: 'forex', direction: 'up', amount, leverage: 100 } })).body;
  const a = await open(40), b = await open(60);
  await call('POST', `/trades/${a.id}/close`, { token: u.token });
  await call('POST', `/trades/${b.id}/close`, { token: u.token });
  const list = (await call('GET', `/trades?status=closed&accountId=${u.demo.id}`, { token: u.token })).body.trades;
  const s = (await call('GET', `/trades/summary?accountId=${u.demo.id}&tz=Africa/Lagos`, { token: u.token })).body;
  const pnl = list.reduce((x, t) => x + Number(t.pnl), 0);
  assert.equal(s.tz, 'Africa/Lagos');
  assert.equal(s.days[0].trades, 2);
  assert.equal(s.days[0].traded, 100);
  assert.ok(Math.abs(s.days[0].net - pnl) < 0.005, 'net is the sum of the results');
  assert.ok(Math.abs(s.days[0].won - s.days[0].lost - s.days[0].net) < 0.005, 'won minus lost is the net');
  assert.equal(s.weeks[0].traded, 100, 'the week holds today');
  assert.equal((await call('GET', `/trades/summary?accountId=${u.demo.id}&tz=Not/AZone'%3B`, { token: u.token })).body.tz, 'UTC', 'an unknown zone falls back');
  assert.equal((await call('GET', '/trades/summary?accountId=bad', { token: u.token })).status, 400);
  assert.equal((await call('GET', `/trades/summary?accountId=${u.demo.id}`, {})).status, 401, 'needs a login');
});

test('inzone and forex settle, manual close works, analysis returns three points', async () => {
  const u = await signUp();
  const iz = await call('POST', '/trades', { token: u.token, body: { accountId: u.demo.id, assetId: 'EURUSD', mode: 'inzone', amount: 10, durationSec: 5 } });
  assert.equal(iz.status, 201);
  assert.ok(Number(iz.body.zone_pct) > 0 && iz.body.direction === null);

  const fx = await call('POST', '/trades', { token: u.token, body: { accountId: u.demo.id, assetId: 'EURUSD', mode: 'forex', direction: 'up', amount: 50, leverage: 100 } });
  assert.equal(fx.status, 201);
  assert.equal((await call('POST', '/trades', { token: u.token, body: { accountId: u.demo.id, assetId: 'EURUSD', mode: 'forex', direction: 'up', amount: 50, leverage: 501 } })).body.code, 'INVALID_LEVERAGE');
  assert.equal((await call('POST', `/trades/${iz.body.id}/close`, { token: u.token })).status, 400, 'only forex closes early');

  const closed = await call('POST', `/trades/${fx.body.id}/close`, { token: u.token });
  assert.equal(closed.status, 200);
  const fxOpen = Number(closed.body.open_quote), fxClose = Number(closed.body.close_quote);
  const wantReturn = Math.max(0, Math.round((50 + 50 * 100 * (fxClose - fxOpen) / fxOpen) * 100) / 100);
  assert.equal(Number(closed.body.return_amount), wantReturn, 'forex P&L = stake x leverage x move');

  await sleep(6000);
  const izDone = (await call('GET', `/trades/${iz.body.id}`, { token: u.token })).body;
  assert.equal(izDone.status, 'closed');
  const inside = Math.abs(izDone.close_quote - izDone.open_quote) / izDone.open_quote * 100 <= Number(izDone.zone_pct);
  assert.equal(izDone.result, inside ? 'win' : 'loss');

  const a = await call('POST', `/trades/${iz.body.id}/analyze`, { token: u.token });
  assert.equal(a.status, 200);
  assert.equal(a.body.points.length, 3);
  assert.ok(a.body.points.every((p) => typeof p === 'string' && p.length > 20));
});

test('refusals: other users, live accounts, bad input', async () => {
  const u = await signUp();
  const v = await signUp();
  const ngn = u.me.accounts.find((a) => a.type === 'NGN');
  const t = (body) => call('POST', '/trades', { token: u.token, body: { accountId: u.demo.id, assetId: 'EURUSD', mode: 'fixed_time', direction: 'up', amount: 10, durationSec: 30, ...body } });

  assert.equal((await t({ accountId: v.demo.id })).body.code, 'ACCOUNT_NOT_FOUND');
  assert.equal((await t({ accountId: ngn.id })).body.code, 'LIVE_TRADING_DISABLED');
  assert.equal((await t({ amount: 0.5 })).body.code, 'INVALID_AMOUNT');
  assert.equal((await t({ durationSec: 99999 })).body.code, 'INVALID_DURATION');
  assert.equal((await t({ assetId: 'NOPE' })).status, 400);
  assert.equal((await t({ direction: 'sideways' })).status, 400);

  const mine = await t({});
  assert.equal((await call('GET', `/trades/${mine.body.id}`, { token: v.token })).status, 404, 'cannot read another user\'s trade');
  assert.equal((await call('PATCH', '/me', { token: v.token, body: { activeAccountId: u.demo.id } })).status, 400);
  assert.equal((await call('POST', '/accounts/demo/reset', { token: u.token })).body.code, 'OPEN_TRADES_EXIST');
});

test('demo reset restores 10,000', async () => {
  const u = await signUp();
  await call('POST', '/trades', { token: u.token, body: { accountId: u.demo.id, assetId: 'EURUSD', mode: 'fixed_time', direction: 'up', amount: 500, durationSec: 5 } });
  await sleep(6000);
  const r = await call('POST', '/accounts/demo/reset', { token: u.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await balance(u), 10000);
});

test('tasks: accept, progress from trades, reward credited once', async () => {
  const u = await signUp();
  assert.equal((await call('GET', '/tasks', { token: u.token })).body.length, 4);
  assert.equal((await call('POST', '/tasks/first_trade/accept', { token: u.token })).status, 200);
  assert.equal((await call('POST', '/tasks/first_trade/accept', { token: u.token })).status, 400, 'cannot re-accept while active');
  await call('POST', '/trades', { token: u.token, body: { accountId: u.demo.id, assetId: 'EURUSD', mode: 'fixed_time', direction: 'up', amount: 10, durationSec: 5 } });
  await sleep(6000);
  const task = (await call('GET', '/tasks', { token: u.token })).body.find((x) => x.id === 'first_trade');
  assert.equal(task.status, 'completed');
  const tx = (await call('GET', '/transactions', { token: u.token })).body.filter((x) => x.type === 'task_reward');
  assert.equal(tx.length, 1);
  assert.equal(Number(tx[0].amount), 10);
  const notes = (await call('GET', '/notifications', { token: u.token })).body;
  assert.ok(notes.some((n) => n.title === 'Task complete'));
  assert.ok(notes.some((n) => n.title === 'Welcome to Oliskey Alpha'), 'welcome message on sign-up');
  assert.ok(notes.some((n) => /^(Trade won|Trade lost|Amount returned)/.test(n.title) && n.link === '/history'), 'closed trade creates a notification');
  assert.equal((await call('GET', '/me', { token: u.token })).body.unreadNotifications, notes.length);
  const stats = (await call('GET', `/stats?accountId=${u.demo.id}`, { token: u.token })).body;
  assert.equal(stats.total, 1, 'profile numbers count the finished trade');
  assert.equal((await call('GET', '/stats?accountId=nope', { token: u.token })).status, 400);
  const rewards = (await call('GET', '/rewards', { token: u.token })).body;
  assert.equal(rewards.length, 1, 'the task reward shows on the rewards page');
  assert.equal(Number(rewards[0].amount), 10);
  await call('POST', '/notifications/read', { token: u.token });
  assert.equal((await call('GET', '/me', { token: u.token })).body.unreadNotifications, 0);
});

test('money flows are switched off and admin routes are protected', async () => {
  const u = await signUp();
  const ngn = u.me.accounts.find((a) => a.type === 'NGN');
  const dep = await call('POST', '/payments/deposit', { token: u.token, body: { accountId: ngn.id, amount: 5000 } });
  assert.equal(dep.status, 403);
  assert.equal(dep.body.error, 'Real-money trading is coming soon.');
  assert.equal((await call('GET', '/admin/withdrawals', { token: u.token })).status, 403);
  assert.equal((await call('POST', '/admin/settings', { token: u.token, body: { live_trading_enabled: true } })).status, 403);

  const forged = JSON.stringify({ event: 'charge.success', data: { reference: 'x' } });
  const sig = createHmac('sha512', 'wrong-secret').update(forged).digest('hex');
  assert.equal((await call('POST', '/payments/paystack/webhook', { body: forged, headers: { 'x-paystack-signature': sig } })).status, 401);
  assert.equal((await call('GET', '/promo-codes', { token: u.token })).body.length, 2);
});
