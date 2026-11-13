// Scheduled AI Trading jobs on the local TEST database (DATABASE_URL must point at oliskey_alpha_test; skipped otherwise).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const onTestDb = /\/oliskey_alpha_test(\?|$)/.test(process.env.DATABASE_URL ?? '');
const skip = !onTestDb && 'needs DATABASE_URL set to the local test database';
let pool, jobs, user;
before(async () => {
  if (!onTestDb) return;
  ({ pool } = await import('../src/db.js'));
  jobs = await import('../src/trading/jobs.js');
  ({ rows: [user] } = await pool.query(`insert into auth.users (email) values ($1) returning id`, [`jobs${Date.now()}@test.local`]));
});
// fills are append-only, so a user with a fill cannot be deleted (by design); the test user stays in the test database
after(async () => { if (user) await pool.query('delete from auth.users where id = $1', [user.id]).catch(() => {}); await pool?.end(); });

const subscription = async (strategy, { ended, cancel = false }) => {
  const { rows: [pay] } = await pool.query(`insert into trading.subscription_payments (user_id, provider, reference, strategies, amount_usd, amount, currency, fx_rate)
    values ($1, 'paystack', $2, $3, '2.50', '3374.56', 'NGN', '1349.82') returning id`, [user.id, `OAT-S-${crypto.randomUUID()}`, [strategy]]);
  await pool.query(`insert into trading.strategy_subscriptions (user_id, strategy_id, status, payment_id, current_period_start, current_period_end, cancel_at_period_end)
    values ($1, $2, 'active', $3, now() - interval '31 days', now() - make_interval(mins => $4), $5)`, [user.id, strategy, pay.id, ended ? 5 : -60 * 24, cancel]);
};

test('a finished month expires and its allocation pauses; a cancelled one becomes cancelled; a running one stays', { skip }, async () => {
  await subscription('strict_swing', { ended: true });
  await subscription('balanced_swing', { ended: true, cancel: true });
  await subscription('strict_scalping', { ended: false });
  const { rows: [conn] } = await pool.query(`insert into trading.exchange_connections (user_id, provider_id, environment, key_hint, credentials_ciphertext, credentials_key_id, status)
    values ($1, 'binance', 'testnet', 'abcd', 'test-only', 'k1', 'active') returning id`, [user.id]);
  await pool.query(`insert into trading.strategy_allocations (user_id, strategy_id, connection_id, amount) values ($1, 'strict_swing', $2, '100')`, [user.id, conn.id]);
  await jobs.expireSubscriptions({ client: pool });
  const { rows } = await pool.query('select strategy_id, status from trading.strategy_subscriptions where user_id = $1 order by strategy_id', [user.id]);
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.strategy_id, r.status])), { balanced_swing: 'cancelled', strict_scalping: 'active', strict_swing: 'expired' });
  const { rows: [a] } = await pool.query(`select status from trading.strategy_allocations where user_id = $1 and strategy_id = 'strict_swing'`, [user.id]);
  assert.equal(a.status, 'paused');
  assert.equal((await jobs.expireSubscriptions({ client: pool })).ended, 0, 'running it again changes nothing');
});

test('an order stuck as unknown is settled from the exchange, and its fills are recorded once', { skip }, async () => {
  const { rows: [conn] } = await pool.query(`select id from trading.exchange_connections where user_id = $1 limit 1`, [user.id]);
  await pool.query(`insert into trading.positions (user_id, strategy_id, environment, symbol, quantity) values ($1, 'strict_swing', 'testnet', 'BTCUSDT', 0)`, [user.id]);
  const { rows: [o] } = await pool.query(`insert into trading.trading_orders (user_id, connection_id, strategy_id, environment, symbol, side, type, quote_quantity, idempotency_key, client_order_id, status, created_at)
    values ($1, $2, 'strict_swing', 'testnet', 'BTCUSDT', 'buy', 'market', 100, $3, $4, 'unknown', now() - interval '5 minutes') returning id`, [user.id, conn.id, `jobs-${Date.now()}`, `oatjobs${Date.now()}`]);
  const fake = { orderStatus: async () => ({ status: 'filled', exchangeOrderId: 'X1' }),
    fills: async () => [{ id: 'f1', price: '70000', quantity: '0.001', quoteQuantity: '70', fee: '0.07', feeAsset: 'USDT', time: Date.now() }] };
  const r1 = await jobs.reconcileOrders({ client: pool, deps: { adapterFor: () => fake } });
  await jobs.reconcileOrders({ client: pool, deps: { adapterFor: () => fake } });
  assert.ok(r1.settled >= 1);
  const { rows: [after_] } = await pool.query('select status, exchange_order_id from trading.trading_orders where id = $1', [o.id]);
  assert.deepEqual(after_, { status: 'filled', exchange_order_id: 'X1' });
  const { rows: [{ n }] } = await pool.query('select count(*)::int as n from trading.trade_fills where order_id = $1', [o.id]);
  assert.equal(n, 1, 'one fill, never twice');
  const { rows: [p] } = await pool.query(`select quantity from trading.positions where user_id = $1 and strategy_id = 'strict_swing' and symbol = 'BTCUSDT'`, [user.id]);
  assert.equal(p.quantity, '0.00100000', 'the holding is rebuilt from the fill');
});
