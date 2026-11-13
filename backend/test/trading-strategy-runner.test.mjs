// The four strategies follow the AI Spot agents on practice only. Rules: test the pure decision; then one full pass on the
// local TEST database (needs DATABASE_URL like the other trading tests): a TRADE becomes one buy signal, never twice; every
// decision is kept; stale prices never trade; the agents' exit becomes one sell; only testnet allocations get orders.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { decide, runOnce, RULES } from '../src/trading/strategyRunner.js';

const NOW = Date.parse('2026-11-12T22:20:00Z');
const REG = { strategies: [
  { strategy_id: 'trend_breakout', version: '0.1.0', symbol: 'BTCUSDT', verdict: 'APPROVED_FOR_PAPER' },
  { strategy_id: 'squeeze_breakout', version: '0.1.0', symbol: 'BASKET', coins: ['BTCUSDT', 'ETHUSDT'], verdict: 'APPROVED_FOR_PAPER' },
  { strategy_id: 'range_reversion', version: '0.1.0', symbol: 'BTCUSDT', verdict: 'MORE_DATA' },
] };
const row = (over = {}) => ({
  id: `4h|BTCUSDT|${over.bar ?? '2026-11-12T20:00:00+00:00'}`, symbol: 'BTCUSDT', timeframe: '4h', decision: 'TRADE',
  decided_at: new Date(NOW - 60_000).toISOString(), order_id: `trend_breakout|0.1.0|BTCUSDT|${over.bar ?? '2026-11-12T20:00:00+00:00'}`,
  agents: [{ agent: 'exit', verdict: 'PASS', data: { entry: 71500.5, stop: 70100.25, target: 74300 } }, { agent: 'collaboration', verdict: 'PASS', data: { blockers: [] } }],
  ...over,
});
const fresh = { price: '71510.00000000', time: NOW - 2_000 };

test('the decision rules', () => {
  assert.equal(decide('strict_swing', row(), { registry: REG, price: fresh, now: NOW }).decision, 'trade');
  assert.equal(decide('balanced_swing', row(), { registry: REG, price: fresh, now: NOW }).decision, 'trade');
  const basketOnly = row({ order_id: 'squeeze_breakout|0.1.0|BTCUSDT|x' });
  assert.equal(decide('strict_swing', basketOnly, { registry: REG, price: fresh, now: NOW }).decision, 'skip', 'strict needs approval on the coin itself');
  assert.equal(decide('balanced_swing', basketOnly, { registry: REG, price: fresh, now: NOW }).decision, 'trade', 'balanced accepts the basket');
  assert.equal(decide('balanced_swing', row({ order_id: 'range_reversion|0.1.0|BTCUSDT|x' }), { registry: REG, price: fresh, now: NOW }).decision, 'skip', 'not approved by the lab');
  assert.match(decide('strict_swing', row(), { registry: REG, price: { ...fresh, time: NOW - 31_000 }, now: NOW }).explanation, /stale/, 'stale price');
  assert.equal(decide('strict_swing', row(), { registry: REG, price: null, now: NOW }).decision, 'skip', 'no price');
  assert.match(decide('strict_swing', row({ decided_at: new Date(NOW - 11 * 60_000).toISOString() }), { registry: REG, price: fresh, now: NOW }).explanation, /too old/);
  assert.match(decide('strict_swing', row(), { registry: REG, price: { price: '71900', time: NOW }, now: NOW }).explanation, /ran past/, 'more than 0.5% above the plan');
  assert.match(decide('strict_swing', row(), { registry: REG, price: { price: '70000', time: NOW }, now: NOW }).explanation, /stop/);
  assert.equal(decide('strict_swing', row({ decision: 'WAIT' }), { registry: REG, price: fresh, now: NOW }).decision, 'wait');
  assert.equal(decide('strict_swing', row({ decision: 'NO_TRADE', agents: [{ agent: 'collaboration', data: { blockers: ['Risk Manager'] } }] }), { registry: REG, price: fresh, now: NOW }).decision, 'veto');
  assert.deepEqual(Object.values(RULES).map((r) => r.timeframe), ['15m', '15m', '4h', '4h'], 'scalping 15m, swing 4h');
});

// ── a full pass on the test database ──
const onTestDb = /\/oliskey_alpha_test(\?|$)/.test(process.env.DATABASE_URL ?? '');
let pool;
const tag = `r${Date.now()}`;
before(async () => {
  if (!onTestDb) return;   // the database pass below is skipped; the rules above still run
  ({ pool } = await import('../src/db.js'));
  // the AI engine creates these on the real database; the test database gets the same shape if it has none
  await pool.query(`create schema if not exists intel;
    create table if not exists intel.spot_agent_decisions (id text primary key, symbol text not null, timeframe text not null, bar_at timestamptz not null,
      decided_at timestamptz not null default now(), decision text not null check (decision in ('TRADE','NO_TRADE','WAIT')), strategy_id text, order_id text,
      risk_pct double precision, vetoed jsonb not null default '[]', agents jsonb not null);
    create table if not exists intel.spot_paper_trades (id text primary key, strategy_id text not null, version text not null, symbol text not null,
      timeframe text not null, status text not null check (status in ('open','closed')), signal_at timestamptz not null, entry_at timestamptz not null,
      entry double precision not null, stop0 double precision not null, stop_now double precision, target double precision, last_price double precision,
      exit_at timestamptz, exit double precision, reason text, r double precision, mfe_r double precision, mae_r double precision, bars integer, regime text,
      updated_at timestamptz not null default now())`);
});
after(async () => {
  await pool?.query(`delete from intel.spot_agent_decisions where id like $1`, [`%${tag}%`]);
  await pool?.query(`delete from intel.spot_paper_trades where id like $1`, [`%${tag}%`]);
  await pool?.end();
});

test('one pass: one buy signal per TRADE, decisions kept, exits become one sell, testnet only', { skip: !onTestDb && 'needs DATABASE_URL set to the local test database' }, async () => {
  const now = Date.now();
  const bar = `${tag}-bar`;
  const r = row({ bar, decided_at: new Date(now - 30_000).toISOString() });
  r.id = `4h|BTCUSDT|${bar}`; r.order_id = `trend_breakout|0.1.0|BTCUSDT|${bar}`;
  await pool.query(`insert into intel.spot_agent_decisions (id, symbol, timeframe, bar_at, decided_at, decision, order_id, agents) values ($1, 'BTCUSDT', '4h', now(), $2, 'TRADE', $3, $4)`,
    [r.id, r.decided_at, r.order_id, JSON.stringify(r.agents)]);

  // one testnet and one live allocation for strict_swing; only the testnet one may get an order
  const { rows: [u] } = await pool.query(`insert into auth.users (email) values ($1) returning id`, [`runner-${tag}@test.local`]);
  const conn = async (env) => (await pool.query(`insert into trading.exchange_connections (user_id, provider_id, environment, key_hint, credentials_ciphertext, credentials_key_id, status)
    values ($1, 'binance', $2, 'abcd', 'test-only', 'k1', 'active') returning id`, [u.id, env])).rows[0].id;
  const testnet = await conn('testnet');
  await pool.query(`insert into trading.strategy_allocations (user_id, strategy_id, connection_id, amount) values ($1, 'strict_swing', $2, '100')`, [u.id, testnet]);
  let live = null;
  try { live = await conn('live'); await pool.query(`insert into trading.strategy_allocations (user_id, strategy_id, connection_id, amount) values ($1, 'strict_swing', $2, '100')`, [u.id, live]); }
  catch { live = null; /* the database may already refuse a live connection before approval: even better */ }

  const calls = [];
  const deps = { registry: REG, price: async () => ({ price: '71510.00000000', time: Date.now() }), placeOrder: async (o) => { calls.push(o); return { placed: false, rules: [] }; } };
  const first = await runOnce(deps);
  const again = await runOnce(deps);
  const { rows: sigs } = await pool.query(`select s.side, v.strategy_id, s.reference_price from trading.trading_signals s join trading.strategy_versions v on v.id = s.strategy_version_id where s.reasons->>'intel_decision' = $1`, [r.id]);
  assert.deepEqual(sigs.map((s) => s.strategy_id).sort(), ['balanced_swing', 'strict_swing'], 'one buy per swing strategy');
  assert.ok(sigs.every((s) => s.side === 'buy' && s.reference_price === '71510.00000000'));
  assert.equal(again.signals, 0, 'the same decision never makes a second signal');
  assert.ok(first.decisions >= 2);
  const { rows: kept } = await pool.query(`select strategy_id, decision from trading.agent_decisions where input->>'intel_decision' = $1 order by strategy_id`, [r.id]);
  assert.deepEqual(kept.map((k) => `${k.strategy_id}:${k.decision}`), ['balanced_swing:trade', 'strict_swing:trade'], 'every decision is kept');
  assert.equal(calls.length, 1, 'one order attempt: the testnet allocation only');
  assert.equal(calls[0].userId, u.id);
  assert.equal(calls[0].side, 'buy');
  assert.equal(calls[0].quoteAmount, '100.00000000');

  // the agents close their trade: one sell signal, tried for holdings only (none here), never twice
  await pool.query(`insert into intel.spot_paper_trades (id, strategy_id, version, symbol, timeframe, status, signal_at, entry_at, entry, stop0, exit_at, exit, reason)
    values ($1, 'trend_breakout', '0.1.0', 'BTCUSDT', '4h', 'closed', now(), now(), 71500.5, 70100.25, now(), 72000, 'target')`, [r.order_id]);
  await runOnce({ ...deps, price: async () => ({ price: '72010.00000000', time: Date.now() }) });
  await runOnce(deps);
  const { rows: sells } = await pool.query(`select count(*)::int as n from trading.trading_signals where side = 'sell' and reasons->>'exit_of' in
    (select id::text from trading.trading_signals where reasons->>'intel_decision' = $1)`, [r.id]);
  assert.equal(sells[0].n, 2, 'one sell per buy signal, written once');

  // stale price: nothing is signalled
  const r2 = { ...r, id: `4h|BTCUSDT|${bar}-2`, order_id: `trend_breakout|0.1.0|BTCUSDT|${bar}-2` };
  await pool.query(`insert into intel.spot_agent_decisions (id, symbol, timeframe, bar_at, decided_at, decision, order_id, agents) values ($1, 'BTCUSDT', '4h', now(), now(), 'TRADE', $2, $3)`,
    [r2.id, r2.order_id, JSON.stringify(r.agents)]);
  const stale = await runOnce({ ...deps, price: async () => ({ price: '71510', time: Date.now() - 120_000 }) });
  assert.equal(stale.signals, 0, 'no signal on stale data');
  const { rows: why } = await pool.query(`select explanation from trading.agent_decisions where input->>'intel_decision' = $1`, [r2.id]);
  assert.ok(why.length === 2 && why.every((w) => /stale/.test(w.explanation)), 'the reason is kept');

  await pool.query('delete from auth.users where id = $1', [u.id]);
  if (live) assert.ok(true);
});
