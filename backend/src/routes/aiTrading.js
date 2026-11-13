// Oliskey AI Trading API (exchange-connected, non-custodial). Customer routes under /trading (signed in), admin routes
// under /admin/trading (admins with 2-step login, see requireAdmin). Secrets never leave the server: connection rows are
// returned without the encrypted key, and errors are plain messages without exchange account details.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { idempotent } from '../idempotency.js';
import { isUuid } from '../http.js';
import { vaultConfigured } from '../trading/vault.js';
import { CAPABILITIES } from '../trading/exchanges/adapter.js';
import { hasAdapter } from '../trading/exchanges/index.js';
import { subscriptionPrice, PRICE_PER_STRATEGY_USD } from '../trading/money.js';
import {
  TradingError, audit, RISK_DISCLOSURE_VERSION, connectExchange, verifyConnection, disconnect, listConnections, allocate, declareWithdrawal, financialStatement,
} from '../trading/service.js';
import { startSubscriptionCheckout, startCommissionCheckout, settleTradingPayment } from '../trading/payments.js';

const ENVIRONMENTS = new Set(['testnet', 'live']);
const STRATEGIES = new Set(['strict_scalping', 'balanced_scalping', 'strict_swing', 'balanced_swing']);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  if (e instanceof TradingError || e.status) return res.status(e.status || 400).json({ error: e.message, code: e.code, forbidden: e.forbidden });
  if (e instanceof RangeError) return res.status(400).json({ error: e.message });
  next(e);
});
const bad = (res, error) => res.status(400).json({ error });
// a few attempts per minute: connecting keys is where someone would try stolen credentials
const keyLimiter = rateLimit({ windowMs: 60_000, limit: 6, keyGenerator: (req) => req.user.id, standardHeaders: 'draft-8', legacyHeaders: false });

export function aiTradingRouter(deps = {}) {
  const r = Router();

  r.get('/me', wrap(async (req, res) => {
    const [{ rows: [p] }, { rows: [ctl] }, { rows: [uc] }] = await Promise.all([
      // the email lives in auth.users; profiles has none
      pool.query('select p.full_name, u.email from profiles p join auth.users u on u.id = p.id where p.id = $1', [req.user.id]),
      pool.query('select platform_paused, emergency_stop, live_trading_enabled from trading.controls'),
      pool.query('select paused from trading.user_controls where user_id = $1', [req.user.id]),
    ]);
    res.json({ name: p?.full_name, email: p?.email, twoStep: Boolean(req.user.mfa), tradingPaused: Boolean(uc?.paused), platform: ctl });
  }));

  // Real-money readiness: identity verified and the current risk disclosure accepted (recorded in the append-only audit log).
  r.get('/risk-disclosure', wrap(async (req, res) => {
    const [{ rows: [p] }, { rows: [acc] }] = await Promise.all([
      pool.query('select kyc_status from profiles where id = $1', [req.user.id]),
      pool.query(`select created_at from trading.security_audit_logs where actor_id = $1 and action = 'risk_disclosure.accepted' and details->>'version' = $2 order by created_at desc limit 1`, [req.user.id, RISK_DISCLOSURE_VERSION]),
    ]);
    res.json({ version: RISK_DISCLOSURE_VERSION, accepted: Boolean(acc), acceptedAt: acc?.created_at ?? null, identityVerified: p?.kyc_status === 'verified' });
  }));
  r.post('/risk-disclosure/accept', wrap(async (req, res) => {
    if (req.body?.version !== RISK_DISCLOSURE_VERSION) return bad(res, 'Please read the current risk disclosure and accept it again.');
    await audit(pool, req.user.id, 'risk_disclosure.accepted', 'ai_trading', { version: RISK_DISCLOSURE_VERSION }, req.ip);
    res.json({ accepted: true, version: RISK_DISCLOSURE_VERSION });
  }));

  // "Notify me when live trading opens" (021_live_waitlist.sql). Only ever the signed-in person's own row.
  r.get('/waitlist', wrap(async (req, res) => {
    const { rows: [w] } = await pool.query('select joined_at, left_at from trading.live_waitlist where user_id = $1', [req.user.id]);
    res.json({ joined: Boolean(w && !w.left_at), joinedAt: w && !w.left_at ? w.joined_at : null });
  }));
  r.post('/waitlist', wrap(async (req, res) => {
    await pool.query(`insert into trading.live_waitlist (user_id) values ($1)
      on conflict (user_id) do update set joined_at = case when trading.live_waitlist.left_at is null then trading.live_waitlist.joined_at else now() end, left_at = null`, [req.user.id]);
    await audit(pool, req.user.id, 'waitlist.join', 'live_trading', {}, req.ip);
    res.json({ joined: true });
  }));
  r.delete('/waitlist', wrap(async (req, res) => {
    await pool.query('update trading.live_waitlist set left_at = now() where user_id = $1 and left_at is null', [req.user.id]);
    await audit(pool, req.user.id, 'waitlist.leave', 'live_trading', {}, req.ip);
    res.json({ joined: false });
  }));

  r.get('/dashboard', wrap(async (req, res) => {
    const uid = req.user.id;
    const [conns, { rows: subs }, { rows: allocs }, { rows: positions }, { rows: orders }, { rows: [ctl] }] = await Promise.all([
      listConnections(uid),
      pool.query(`select strategy_id, status, current_period_end from trading.strategy_subscriptions where user_id = $1 and status <> 'cancelled' order by created_at`, [uid]),
      pool.query('select strategy_id, connection_id, amount, status from trading.strategy_allocations where user_id = $1', [uid]),
      pool.query(`select strategy_id, environment, symbol, quantity, cost_basis, realised_pnl, status from trading.positions where user_id = $1 and status = 'open'`, [uid]),
      pool.query('select id, strategy_id, environment, symbol, side, status, created_at from trading.trading_orders where user_id = $1 order by created_at desc limit 10', [uid]),
      pool.query('select platform_paused, emergency_stop, live_trading_enabled from trading.controls'),
    ]);
    res.json({ connections: conns, subscriptions: subs, allocations: allocs, openPositions: positions, recentOrders: orders, platform: ctl });
  }));

  // ── Exchanges ──
  r.get('/exchanges', wrap(async (req, res) => {
    const [{ rows: provs }, { rows: caps }, conns] = await Promise.all([
      pool.query('select id, name, phase, website_url, api_docs_url, key_settings_url, requires_passphrase, adapter_status, live_enabled from trading.exchange_providers order by phase'),
      pool.query('select provider_id, capability, supported from trading.exchange_capabilities'),
      listConnections(req.user.id),
    ]);
    res.json(provs.map((p) => ({
      ...p,
      // what a customer may do today: live only once approved; testnet once the adapter exists; otherwise "coming"
      availability: p.live_enabled ? 'live' : hasAdapter(p.id) ? 'testnet_only' : 'coming_soon',
      capabilities: caps.filter((c) => c.provider_id === p.id && c.supported).map((c) => c.capability),
      connections: conns.filter((c) => c.provider_id === p.id),
    })));
  }));

  r.get('/exchanges/:id/capabilities', wrap(async (req, res) => {
    const { rows } = await pool.query('select capability, supported, notes from trading.exchange_capabilities where provider_id = $1', [req.params.id]);
    res.json({ provider: req.params.id, known: CAPABILITIES, capabilities: rows });
  }));

  r.post('/exchanges/connect', keyLimiter, wrap(async (req, res) => {
    const { providerId, environment, apiKey, apiSecret, passphrase, label } = req.body || {};
    if (!vaultConfigured()) return res.status(503).json({ error: 'Exchange connections are not switched on yet on this server.' });
    if (typeof providerId !== 'string' || !ENVIRONMENTS.has(environment)) return bad(res, 'Choose an exchange and testnet or live.');
    if (typeof apiKey !== 'string' || typeof apiSecret !== 'string' || !/^[\x21-\x7e]{16,128}$/.test(apiKey) || !/^[\x21-\x7e]{16,128}$/.test(apiSecret)) return bad(res, 'Paste the API key and secret exactly as the exchange shows them.');
    if (passphrase !== undefined && (typeof passphrase !== 'string' || passphrase.length > 64)) return bad(res, 'Check the passphrase.');
    if (label !== undefined && (typeof label !== 'string' || label.length > 40)) return bad(res, 'Name up to 40 characters.');
    const row = await connectExchange({ userId: req.user.id, providerId, environment, apiKey, apiSecret, passphrase, label, ip: req.ip }, deps);
    res.status(201).json(row);
  }));

  r.post('/exchanges/verify', keyLimiter, wrap(async (req, res) => {
    if (!isUuid(req.body?.connectionId)) return bad(res, 'connectionId required');
    res.json(await verifyConnection({ userId: req.user.id, id: req.body.connectionId }, deps));
  }));

  r.get('/exchanges/connections', wrap(async (req, res) => res.json(await listConnections(req.user.id))));

  r.delete('/exchanges/connections/:id', wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Connection not found.' });
    res.json(await disconnect({ userId: req.user.id, id: req.params.id, ip: req.ip }));
  }));

  // ── Strategies ──
  r.get('/strategies', wrap(async (req, res) => {
    const [{ rows: strategies }, { rows: subs }, { rows: versions }] = await Promise.all([
      pool.query('select id, name, style, profile, summary from trading.trading_strategies where active order by sort'),
      pool.query(`select strategy_id, status, current_period_end from trading.strategy_subscriptions where user_id = $1 and status in ('pending_payment', 'active', 'past_due')`, [req.user.id]),
      pool.query(`select distinct on (strategy_id) strategy_id, version, status, backtest from trading.strategy_versions where status <> 'retired' order by strategy_id, created_at desc`),
    ]);
    res.json({
      pricePerStrategyUsd: PRICE_PER_STRATEGY_USD,
      strategies: strategies.map((s) => {
        const sub = subs.find((x) => x.strategy_id === s.id), v = versions.find((x) => x.strategy_id === s.id);
        const unlocked = sub?.status === 'active' && new Date(sub.current_period_end) > new Date();
        return {
          ...s, subscription: sub || null,
          version: v ? { version: v.version, status: v.status } : null,
          // a limited preview before payment; detailed analytics after
          preview: v?.backtest ? { trades: v.backtest.trades ?? null, period: v.backtest.period ?? null } : null,
          analytics: unlocked && v?.backtest ? v.backtest : null,
          readyToTrade: Boolean(v && (v.status === 'approved_paper' || v.status === 'approved_live')),
        };
      }),
    });
  }));

  r.get('/strategies/:id', wrap(async (req, res) => {
    if (!STRATEGIES.has(req.params.id)) return res.status(404).json({ error: 'Strategy not found.' });
    const [{ rows: [s] }, { rows: [sub] }, { rows: perf }] = await Promise.all([
      pool.query('select id, name, style, profile, summary from trading.trading_strategies where id = $1', [req.params.id]),
      pool.query(`select status, current_period_end from trading.strategy_subscriptions where user_id = $1 and strategy_id = $2 and status = 'active' and current_period_end > now()`, [req.user.id, req.params.id]),
      pool.query(`select environment, symbol, realised_pnl, fees_quote, status from trading.positions where user_id = $1 and strategy_id = $2`, [req.user.id, req.params.id]),
    ]);
    res.json({ ...s, subscribed: Boolean(sub), myResults: sub ? perf : null });
  }));

  const checkoutHandler = wrap(async (req, res) => {
    const ids = req.body?.strategies;
    if (!Array.isArray(ids) || !ids.every((x) => STRATEGIES.has(x))) return bad(res, 'Choose 1 to 4 strategies.');
    subscriptionPrice(ids);   // validates 1-4, no duplicates
    // owner rule (2026-11-12): no payment for a strategy that is not approved; subscriptions open with real-money trading
    const [{ rows: [ctl] }, { rows: approved }] = await Promise.all([
      pool.query('select live_trading_enabled from trading.controls'),
      pool.query(`select distinct strategy_id from trading.strategy_versions where status = 'approved_live' and strategy_id = any($1)`, [ids]),
    ]);
    if (!ctl?.live_trading_enabled) return res.status(409).json({ error: 'Subscriptions open with live trading.', code: 'NOT_OPEN_YET' });
    if (approved.length !== ids.length) return res.status(409).json({ error: 'This strategy is not approved yet, so it cannot be bought.', code: 'STRATEGY_NOT_APPROVED' });
    const { rows: [p] } = await pool.query('select email from auth.users where id = $1', [req.user.id]);
    res.status(201).json(await startSubscriptionCheckout({ userId: req.user.id, email: p.email, strategyIds: ids }));
  });
  r.post('/billing/checkout', idempotent, checkoutHandler);
  r.post('/strategies/subscribe', idempotent, checkoutHandler);

  r.post('/billing/verify', wrap(async (req, res) => {
    const ref = String(req.body?.reference || '');
    if (!/^OAT-[SC]-[0-9a-f-]{36}$/i.test(ref)) return bad(res, 'reference required');
    const { rows: [own] } = await pool.query(
      `select 1 from trading.subscription_payments where reference = $1 and user_id = $2
       union all select 1 from trading.commission_payments p join trading.commission_invoices i on i.id = p.invoice_id where p.reference = $1 and i.user_id = $2`, [ref, req.user.id]);
    if (!own) return res.status(404).json({ error: 'Payment not found.' });
    res.json(await settleTradingPayment(ref));
  }));

  r.get('/billing/subscriptions', wrap(async (req, res) => {
    const [{ rows: subs }, { rows: pays }] = await Promise.all([
      pool.query('select strategy_id, status, current_period_start, current_period_end, cancel_at_period_end from trading.strategy_subscriptions where user_id = $1 order by created_at desc', [req.user.id]),
      pool.query('select reference, strategies, amount_usd, amount, currency, status, created_at, verified_at from trading.subscription_payments where user_id = $1 order by created_at desc limit 50', [req.user.id]),
    ]);
    res.json({ subscriptions: subs, payments: pays });
  }));

  r.post('/billing/subscriptions/:strategy/cancel', wrap(async (req, res) => {
    const { rowCount } = await pool.query(`update trading.strategy_subscriptions set cancel_at_period_end = true, updated_at = now() where user_id = $1 and strategy_id = $2 and status = 'active'`, [req.user.id, req.params.strategy]);
    if (!rowCount) return res.status(404).json({ error: 'No active subscription for this strategy.' });
    res.json({ cancelAtPeriodEnd: true });
  }));

  r.post('/strategies/allocate', idempotent, wrap(async (req, res) => {
    const { strategyId, connectionId, amount } = req.body || {};
    if (!STRATEGIES.has(strategyId) || !isUuid(connectionId)) return bad(res, 'Choose a strategy and an exchange connection.');
    res.json(await allocate({ userId: req.user.id, strategyId, connectionId, amount: String(amount) }, deps));
  }));

  for (const [action, status] of [['pause', 'paused'], ['resume', 'active']]) {
    r.post(`/strategies/:id/${action}`, wrap(async (req, res) => {
      if (!STRATEGIES.has(req.params.id)) return res.status(404).json({ error: 'Strategy not found.' });
      const { rowCount } = await pool.query('update trading.strategy_allocations set status = $3, updated_at = now() where user_id = $1 and strategy_id = $2', [req.user.id, req.params.id, status]);
      res.json({ strategy: req.params.id, status, allocations: rowCount });
    }));
    r.post(`/trading/${action}`, wrap(async (req, res) => {
      await pool.query(`insert into trading.user_controls (user_id, paused, reason) values ($1, $2, 'customer') on conflict (user_id) do update set paused = excluded.paused, reason = excluded.reason, updated_at = now()`, [req.user.id, action === 'pause']);
      await audit(pool, req.user.id, `trading.${action}`, 'customer', {}, req.ip);
      res.json({ tradingPaused: action === 'pause' });
    }));
  }

  // ── Trading records ──
  r.get('/trading/signals', wrap(async (_req, res) => {
    const { rows } = await pool.query(`select s.id, v.strategy_id, s.symbol, s.side, s.reference_price, s.price_time, s.created_at, s.valid_until
      from trading.trading_signals s join trading.strategy_versions v on v.id = s.strategy_version_id order by s.created_at desc limit 50`);
    res.json(rows);
  }));
  r.get('/trading/orders', wrap(async (req, res) => {
    const { rows } = await pool.query(`select id, strategy_id, environment, symbol, side, type, quantity, quote_quantity, status, status_detail, created_at, updated_at
      from trading.trading_orders where user_id = $1 order by created_at desc limit 100`, [req.user.id]);
    res.json(rows);
  }));
  r.get('/trading/history', wrap(async (req, res) => {
    const { rows } = await pool.query(`select o.strategy_id, o.environment, o.symbol, o.side, f.price, f.quantity, f.quote_quantity, f.fee, f.fee_asset, f.filled_at
      from trading.trade_fills f join trading.trading_orders o on o.id = f.order_id where o.user_id = $1 order by f.filled_at desc limit 200`, [req.user.id]);
    res.json(rows);
  }));
  r.get('/positions', wrap(async (req, res) => {
    const { rows } = await pool.query(`select strategy_id, environment, symbol, quantity, cost_basis, realised_pnl, fees_quote, status, opened_at, closed_at
      from trading.positions where user_id = $1 order by updated_at desc`, [req.user.id]);
    res.json(rows);
  }));

  // ── Commission ──
  r.get('/commissions', wrap(async (req, res) => {
    const { rows } = await pool.query(`select id, number, realised_net_profit, previous_hwm, new_hwm, eligible_profit, rate, commission, customer_share, currency, status, issued_at, paid_at
      from trading.commission_invoices where user_id = $1 order by issued_at desc`, [req.user.id]);
    res.json(rows);
  }));
  r.post('/commissions/withdrawal-declaration', idempotent, wrap(async (req, res) => {
    const { amount, note } = req.body || {};
    if (amount !== undefined && !/^\d+(\.\d{1,8})?$/.test(String(amount))) return bad(res, 'Enter the amount you are withdrawing, or leave it empty.');
    if (note !== undefined && (typeof note !== 'string' || note.length > 200)) return bad(res, 'Note up to 200 characters.');
    res.status(201).json(await declareWithdrawal({ userId: req.user.id, amount: amount === undefined ? undefined : String(amount), note, ip: req.ip }));
  }));
  r.post('/commissions/:id/pay', idempotent, wrap(async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Invoice not found.' });
    const { rows: [ctl] } = await pool.query('select live_trading_enabled from trading.controls');
    if (!ctl?.live_trading_enabled) return res.status(409).json({ error: 'Fee payments open with live trading.', code: 'NOT_OPEN_YET' });
    const { rows: [p] } = await pool.query('select email from auth.users where id = $1', [req.user.id]);
    res.status(201).json(await startCommissionCheckout({ userId: req.user.id, email: p.email, invoiceId: req.params.id }));
  }));
  r.get('/financial-statements', wrap(async (req, res) => res.json(await financialStatement(req.user.id))));

  return r;
}

// ───────────────────────── Admin ─────────────────────────
const AREAS = new Set(['exchange_commercial', 'regulatory_legal', 'api_integration', 'security_assessment', 'penetration_test', 'payment_provider', 'production_environment', 'live_trading_activation']);
const APPROVAL_STATUS = new Set(['not_started', 'in_progress', 'submitted', 'approved', 'rejected']);
const httpsUrl = (v) => v === undefined || v === null || v === '' || (typeof v === 'string' && v.length <= 500 && /^https:\/\/[^\s]+$/.test(v));

export function aiTradingAdminRouter() {
  const r = Router();

  r.get('/overview', wrap(async (_req, res) => {
    const q = async (sql) => (await pool.query(sql)).rows[0];
    const [customers, subs, conns, orders, revenue, risk, ctl, events, waiting] = await Promise.all([
      q('select count(distinct user_id)::int as n from trading.exchange_connections'),
      q(`select count(*)::int as n from trading.strategy_subscriptions where status = 'active' and current_period_end > now()`),
      q(`select count(*) filter (where status = 'active')::int as active, count(*) filter (where status in ('invalid', 'error'))::int as attention from trading.exchange_connections where revoked_at is null`),
      q(`select count(*)::int as total, count(*) filter (where status in ('rejected', 'failed', 'unknown'))::int as problems from trading.trading_orders where created_at > now() - interval '24 hours'`),
      q(`select coalesce(sum(credit) filter (where account = 'revenue_subscriptions'), 0) as subscriptions, coalesce(sum(credit) filter (where account = 'revenue_commission'), 0) as commission from trading.account_ledger`),
      q(`select count(*) filter (where decision = 'rejected')::int as rejected, count(*)::int as total from trading.risk_events where created_at > now() - interval '24 hours'`),
      q('select * from trading.controls'),
      pool.query(`select kind, severity, message, created_at from trading.system_events where severity in ('error', 'critical') order by created_at desc limit 20`),
      q('select count(*) filter (where left_at is null)::int as n from trading.live_waitlist'),
    ]);
    res.json({ customersWithExchange: customers.n, activeSubscriptions: subs.n, connections: conns, orders24h: orders, revenueNgn: revenue, riskChecks24h: risk, controls: ctl, alerts: events.rows, waitlist: waiting.n });
  }));

  r.get('/exchanges', wrap(async (_req, res) => {
    const { rows } = await pool.query(`select p.*, (select json_agg(json_build_object('area', a.area, 'status', a.status)) from trading.admin_approvals a where a.subject = p.id) as approvals
      from trading.exchange_providers p order by p.phase`);
    res.json(rows);
  }));

  r.get('/approvals', wrap(async (_req, res) => {
    const { rows } = await pool.query(`select a.*, (select json_agg(h order by h.changed_at desc) from trading.admin_approval_history h where h.approval_id = a.id) as history
      from trading.admin_approvals a order by a.subject = 'platform' desc, a.subject, a.area`);
    res.json(rows);
  }));

  r.patch('/approvals/:id', wrap(async (req, res) => {
    const { status, evidenceUrl, evidenceNote, responsible, requiredAction } = req.body || {};
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found.' });
    if (status !== undefined && !APPROVAL_STATUS.has(status)) return bad(res, 'Unknown status.');
    if (!httpsUrl(evidenceUrl)) return bad(res, 'Evidence must be an https link.');
    for (const v of [evidenceNote, responsible, requiredAction]) if (v !== undefined && (typeof v !== 'string' || v.length > 1000)) return bad(res, 'Text too long.');
    if (status === 'approved' && (!evidenceUrl || !evidenceNote)) return bad(res, 'An approval needs a link to the evidence and a note describing it.');
    const { rows: [row] } = await pool.query(
      `update trading.admin_approvals set status = coalesce($2, status), evidence_url = coalesce($3, evidence_url), evidence_note = coalesce($4, evidence_note),
         responsible = coalesce($5, responsible), required_action = coalesce($6, required_action), updated_by = $7, updated_at = now() where id = $1 returning *`,
      [req.params.id, status ?? null, evidenceUrl ?? null, evidenceNote ?? null, responsible ?? null, requiredAction ?? null, req.user.id]);
    if (!row) return res.status(404).json({ error: 'Not found.' });
    await audit(pool, req.user.id, 'approval.updated', `${row.area}:${row.subject}`, { status: row.status }, req.ip);
    res.json(row);
  }));

  r.post('/emergency-stop', wrap(async (req, res) => {
    const on = req.body?.on !== false;
    const reason = String(req.body?.reason || '').slice(0, 300);
    if (on && !reason) return bad(res, 'Give a reason for the emergency stop.');
    await pool.query('update trading.controls set emergency_stop = $1, reason = $2, updated_by = $3', [on, reason || null, req.user.id]);
    await pool.query(`insert into trading.system_events (kind, severity, message, details) values ('emergency_stop', 'critical', $1, $2)`, [on ? 'Emergency stop ON' : 'Emergency stop OFF', { by: req.user.id, reason }]);
    await audit(pool, req.user.id, on ? 'emergency_stop.on' : 'emergency_stop.off', 'platform', { reason }, req.ip);
    res.json({ emergencyStop: on });
  }));

  r.post('/pause', wrap(async (req, res) => {
    const on = req.body?.on !== false;
    await pool.query('update trading.controls set platform_paused = $1, updated_by = $2', [on, req.user.id]);
    await audit(pool, req.user.id, on ? 'platform.pause' : 'platform.resume', 'platform', {}, req.ip);
    res.json({ platformPaused: on });
  }));

  r.post('/exchanges/:id/approve-live', wrap(async (req, res) => {
    try {
      const { rows: [row] } = await pool.query('update trading.exchange_providers set live_enabled = true where id = $1 returning id, live_enabled', [req.params.id]);
      if (!row) return res.status(404).json({ error: 'Exchange not found.' });
      await audit(pool, req.user.id, 'exchange.live_enabled', req.params.id, {}, req.ip);
      res.json(row);
    } catch (e) {
      if (String(e.message).startsWith('LIVE_NOT_ALLOWED')) return res.status(409).json({ error: e.message.replace('LIVE_NOT_ALLOWED: ', 'Not allowed: ') });
      throw e;
    }
  }));

  r.get('/security', wrap(async (_req, res) => {
    const { rows } = await pool.query(`select action, target, created_at, details from trading.security_audit_logs
      where action in ('exchange.key_refused', 'exchange.connect_failed', 'emergency_stop.on') order by created_at desc limit 100`);
    res.json(rows);
  }));
  r.get('/audit-logs', wrap(async (req, res) => {
    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    const { rows } = await pool.query('select * from trading.security_audit_logs where id < $1 order by id desc limit 100', [before]);
    res.json(rows);
  }));
  r.get('/risk-events', wrap(async (_req, res) => {
    const { rows } = await pool.query('select * from trading.risk_events order by created_at desc limit 100');
    res.json(rows);
  }));
  return r;
}
