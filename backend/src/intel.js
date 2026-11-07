// Market Intelligence Engine bridge: starts the Python service (127.0.0.1 only) as a child process and exposes it
// to signed-in users at /intel/*. A trade placed from a signal carries that signal's id, so the app can show exactly
// "you took this" or "you skipped this" and how it turned out.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { pool } from './db.js';
import { isUuid, messageFor } from './http.js';
import { notify } from './notify.js';
import { openTrade } from './openTrade.js';
import { fixedTimePlan, signalPlan } from './signalPlan.js';

const INTEL_URL = `http://127.0.0.1:${process.env.INTEL_PORT || 3312}`;
const PYTHON = process.env.INTEL_PYTHON
  || path.join(process.env.LOCALAPPDATA || '', 'oliskey-alpha', 'intel-venv', 'Scripts', 'python.exe');
const SCRIPT = path.resolve(import.meta.dirname, '../../intel/api.py');

export function startIntel() {
  if (!existsSync(PYTHON)) {
    console.warn(`Intelligence Engine not started: Python environment not found at ${PYTHON}`);
    return;
  }
  const run = () => {
    const child = spawn(PYTHON, ['-u', SCRIPT], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
    child.on('exit', (code) => {
      console.warn(`Intelligence Engine stopped (code ${code}); restarting in 10 s`);
      setTimeout(run, 10_000);
    });
    process.on('exit', () => child.kill());
  };
  run();
}

async function intel(pathname) {
  let res;
  try {
    res = await fetch(INTEL_URL + pathname, { signal: AbortSignal.timeout(15_000) });
  } catch {
    const err = new Error('The Intelligence Engine is starting up. Try again in a minute.');
    err.status = 503;
    throw err;
  }
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(body?.detail || 'Intelligence Engine error');
    err.status = res.status;
    throw err;
  }
  return body;
}

// ── Forward test ──
// Each signal the engine publishes on a live-priced market is traded with demo money in the Engine demo account, one trade
// per coin at a time. Forex-mode signals use take profit / stop loss matching the engine's target / stop and close at the
// time limit; Fixed Time signals run their 60 minutes. Setups marked "don't enter" are not traded: tracking.py still
// records how they would have ended, so skipping them can be judged without pretending they were its choices.
const ENGINE_EMAIL = 'engine@oliskey-alpha.local';   // system user: no password, cannot log in
const PAPER_AMOUNT = 100;
const PAPER_LEVERAGE = 10;
// signals with no stop or target: they run their time, as tested. "wide": the coins outside the models' training
const QUICK = { crypto_ft: 'fixed_time', crypto_iz: 'inzone', crypto_ft_wide: 'fixed_time', crypto_iz_wide: 'inzone' };

// ── The AI trading for each user ──
// Owner decisions 2026-11-06: at least 100 per trade, raised by the user; each user chooses "always ask" or "auto trade"; demo starts on
// auto trade, real money on always ask. Only demo accounts are ever traded here. Real money stays closed behind the real-money gate
// (licensed feed and a lawyer's written sign-off), so a user's real choice is only stored.
export const groupStopped = (groups, cls) => { const g = groups?.[cls]; return !g || !!g.paused || g.status === 'blocked'; };   // unknown groups may not trade
// A user's money only goes where testing earned: the AI's own account keeps measuring the rest, and if a group's tests turn positive it comes back by itself.
export const earnsInTests = (groups, cls) => !groupStopped(groups, cls) && Number(groups[cls].test?.avg_r) > 0;
export const AUTO_MIN = 100;
const AUTO_MAX = 10_000_000;
const AUTO_DEFAULTS = { demo: 'auto', real: 'ask' };
const AUTO_BATCH = 500;
const AUTO_AT_ONCE = 10;       // well inside the database's connection pool, so people using the app are never left waiting
const AUTO_MAX_TRADE = 0.15;   // no single trade the AI places may be above this share of the money
const AUTO_MAX_OPEN = 0.5;     // nor may its open trades together be above this share
// `balance` is what is free now, so the money in its open trades is added back to get the whole. If the limit is under the user's
// amount, that trade is skipped: the amount is their choice, and it is never quietly changed.
export function withinLimits(balance, amount, openAuto) {
  const whole = balance + openAuto;
  return amount <= balance && amount <= whole * AUTO_MAX_TRADE && openAuto + amount <= whole * AUTO_MAX_OPEN;
}

// When the AI takes a signal: users on auto trade get the same trade at their own amount, users on always ask get asked.
// `orderFor(amount)` builds the order, so a Forex stop and target stay in proportion to each user's amount.
export async function tradeForUsers({ idea, mode, engineUserId, engine, settlement, orderFor }) {
  // every user, a batch at a time, so one signal can reach any number of them without holding up the database
  let placed = 0, after = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const rows = await autoBatch({ idea, mode, engineUserId, after });
    for (let i = 0; i < rows.length; i += AUTO_AT_ONCE) {
      const done = await Promise.all(rows.slice(i, i + AUTO_AT_ONCE).map((u) => tradeForOne(u, idea, engine, settlement, orderFor)));
      placed += done.filter(Boolean).length;
    }
    if (rows.length < AUTO_BATCH) return placed;
    after = rows[rows.length - 1].user_id;
  }
}

async function autoBatch({ idea, mode, engineUserId, after }) {
  const { rows } = await pool.query(
    `select a.user_id, a.id as account_id, a.balance, coalesce(s.amount, $1) as amount, coalesce(s.mode, $2) as mode,
       (select coalesce(sum(t.amount), 0) from trades t where t.account_id = a.id and t.status = 'open' and t.auto) as open_auto
     from accounts a
     join auth.users u on u.id = a.user_id
     join profiles p on p.id = a.user_id
     left join auto_trade_settings s on s.user_id = a.user_id and s.scope = 'demo'
     where a.type = 'DEMO' and p.deleted_at is null and a.user_id <> $3 and u.email not like '%@test.local'
       and not exists (select 1 from trades t where t.user_id = a.user_id and t.status = 'open' and t.mode = $4 and t.asset_id = $5)
       and not exists (select 1 from trades t where t.user_id = a.user_id and t.idea_id = $6)
       and a.user_id > $7
     order by a.user_id limit ${AUTO_BATCH}`,
    [AUTO_MIN, AUTO_DEFAULTS.demo, engineUserId, mode, idea.asset_id, idea.id, after]);
  return rows;
}

async function tradeForOne(u, idea, engine, settlement, orderFor) {
  try {
    if (u.mode === 'ask') {
      if (await claimAlert(`ask:${idea.id}:${u.user_id}`)) {
        await notify(u.user_id, 'activities', 'The AI wants your OK on a trade', 'It can lose. Open the AI trader to approve or skip it.', '/scanner?tab=ai');
      }
      return false;
    }
    if (!withinLimits(Number(u.balance), Number(u.amount), Number(u.open_auto))) return false;
    await openTrade({ userId: u.user_id, engine, settlement, order: { ...orderFor(Number(u.amount)), accountId: u.account_id, auto: true } });
    return true;
  } catch (err) {
    console.error('AI trade for a user', idea.asset_id, err.message);   // one user's trade must not stop the others
    return false;
  }
}

export function startPaperTrading({ engine, settlement }) {
  let userId = null;
  let demoId = null;
  const skipped = new Set();   // setups whose price had already passed the stop or target when seen

  async function ensureAccount() {
    let { rows } = await pool.query('select id from auth.users where email = $1', [ENGINE_EMAIL]);
    if (!rows[0]) {
      ({ rows } = await pool.query(
        `insert into auth.users (email, raw_user_meta_data) values ($1, '{"full_name":"Oliskey Alpha Engine"}') returning id`,
        [ENGINE_EMAIL]));
    }
    userId = rows[0].id;
    demoId = (await pool.query("select id from accounts where user_id = $1 and type = 'DEMO'", [userId])).rows[0].id;
  }

  async function step() {
    if (!userId) await ensureAccount();
    const ideas = await intel('/ideas?limit=200');
    const { rows: done } = await pool.query('select idea_id from intel.paper_trades');
    const taken = new Set(done.map((d) => Number(d.idea_id)));
    // the learning loop decides each setup first: no decision yet, or a proven rule says skip, means no trade
    const { rows: decisions } = await pool.query('select idea_id from intel.ai_decisions where take');
    const allowed = new Set(decisions.map((d) => Number(d.idea_id)));

    // One trade per coin within each trade type, as each was tested. InZone on a coin must not stop a Fixed Time signal on it.
    const { rows: running } = await pool.query(`select t.asset_id, t.mode from intel.paper_trades p join trades t on t.id = p.trade_id where t.status = 'open'`);
    const holding = new Set(running.map((r) => `${r.mode}:${r.asset_id}`));

    // the safety stop binds the AI too: a paused or blocked group opens nothing, for it or for anyone it trades for
    const { groups } = await intel('/evidence');
    const stopped = (cls) => groupStopped(groups, cls);

    const place = async (i) => {
      const held = `${QUICK[i.asset_class] ?? 'forex'}:${i.asset_id}`;
      if (i.kind !== 'idea' || holding.has(held) || stopped(i.asset_class)) return;
      if (taken.has(i.id) || skipped.has(i.id) || !allowed.has(i.id) || i.status !== 'open' || !engine.isLive(i.asset_id) || !engine.isFresh(i.asset_id)) return;
      if (Date.now() > new Date(i.enter_until).getTime()) return;
      const tick = engine.getPrice(i.asset_id);
      if (!tick) return;
      const q = tick.price;
      const quick = QUICK[i.asset_class];
      if (quick) {
        const { rows: acct } = await pool.query('select balance from accounts where id = $1', [demoId]);
        if (Number(acct[0].balance) < PAPER_AMOUNT) await pool.query('select reset_demo($1)', [userId]).catch(() => {});
        const durationSec = Math.round((new Date(i.expires_at).getTime() - new Date(i.bar_time).getTime()) / 1000);
        const trade = await openTrade({ userId, engine, settlement, order: { accountId: demoId, assetId: i.asset_id, mode: quick, direction: i.direction > 0 ? 'up' : 'down', amount: PAPER_AMOUNT, durationSec } });
        await pool.query('insert into intel.paper_trades (idea_id, trade_id) values ($1, $2) on conflict do nothing', [i.id, trade.id]);
        holding.add(held);
        console.log(`AI trader: ${quick} ${i.asset_id} for signal #${i.id}`);
        if (earnsInTests(groups, i.asset_class)) await tradeForUsers({ idea: i, mode: quick, engineUserId: userId, engine, settlement,
          orderFor: (amount) => ({ assetId: i.asset_id, mode: quick, direction: i.direction > 0 ? 'up' : 'down', amount, durationSec, ideaId: i.id }) });
        return;
      }
      const toTarget = i.direction * (i.target - q);
      const toStop = i.direction * (q - i.stop);
      if (toTarget <= 0 || toStop <= 0) { skipped.add(i.id); return; }
      const money = (move, stake = PAPER_AMOUNT) => Math.max(0.01, Math.round(stake * PAPER_LEVERAGE * (move / q) * 100) / 100);

      const { rows: acc } = await pool.query('select balance from accounts where id = $1', [demoId]);
      if (Number(acc[0].balance) < PAPER_AMOUNT) {
        await pool.query('select reset_demo($1)', [userId]).catch(() => {});   // only resets when nothing is open
      }
      const { rows } = await pool.query('select * from open_trade($1, $2, $3, $4, $5, $6, $7, null, $8, $9, $10)',
        [userId, demoId, i.asset_id, 'forex', i.direction > 0 ? 'up' : 'down', PAPER_AMOUNT, q,
          PAPER_LEVERAGE, money(toTarget), money(toStop)]);
      settlement.add(rows[0]);
      await pool.query('insert into intel.paper_trades (idea_id, trade_id) values ($1, $2) on conflict do nothing',
        [i.id, rows[0].id]);
      holding.add(held);
      console.log(`AI trader: Forex ${i.direction > 0 ? 'Up' : 'Down'} ${i.asset_id} for signal #${i.id}`);
      if (earnsInTests(groups, i.asset_class)) await tradeForUsers({ idea: i, mode: 'forex', engineUserId: userId, engine, settlement,
        orderFor: (amount) => ({ assetId: i.asset_id, mode: 'forex', direction: i.direction > 0 ? 'up' : 'down', amount, leverage: PAPER_LEVERAGE, takeProfit: money(toTarget, amount), stopLoss: money(toStop, amount), ideaId: i.id, ideaEndsAt: i.expires_at }) });
    };
    // one trade that cannot open must not stop the others
    for (const i of ideas) await place(i).catch((err) => console.error('AI trader', i.asset_id, err.message));

    // Time exit at the setup's horizon. Fixed Time and InZone end by themselves at their full duration.
    const { rows: due } = await pool.query(
      `select p.trade_id from intel.paper_trades p
       join intel.ideas i on i.id = p.idea_id join trades t on t.id = p.trade_id
       where t.status = 'open' and t.mode = 'forex' and i.expires_at <= now()`);
    for (const d of due) await settlement.closeNow(d.trade_id);
  }

  // Every 15 s: entering late costs Fixed Time in testing, and a slow round must never overlap the next and place a trade twice.
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    await step().catch((err) => {
      if (err.status !== 503) console.error('forward test', err.message);
    });
    busy = false;
  };
  setTimeout(run, 20_000);
  setInterval(run, 15_000);
}

// Demo-money results of the forward test, by kind of call.
async function paperStats() {
  const { rows } = await pool.query(
    `select i.kind, t.status, t.result, t.pnl from intel.paper_trades p
     join intel.ideas i on i.id = p.idea_id join trades t on t.id = p.trade_id`);
  const block = (kind) => {
    const rs = rows.filter((r) => r.kind === kind);
    const closed = rs.filter((r) => r.status === 'closed');
    const wins = closed.filter((r) => Number(r.pnl) > 0).length;
    return {
      opened: rs.length, open: rs.length - closed.length, closed: closed.length, wins,
      hit_rate: closed.length ? wins / closed.length : null,
      pnl: Math.round(closed.reduce((s, r) => s + Number(r.pnl), 0) * 100) / 100,
    };
  };
  return { stake: PAPER_AMOUNT, leverage: PAPER_LEVERAGE, ideas: block('idea'), avoided: block('avoid') };
}

// ── Alerts ──
// A new signal goes to everyone once; a group's safety stop too. A followed trade's result is sent when it closes (notify.js).
const claimAlert = async (key) => (await pool.query('insert into signal_alerts (key) values ($1) on conflict do nothing', [key])).rowCount === 1;
const everyone = async () => (await pool.query(
  `select p.id from profiles p join auth.users u on u.id = p.id where p.deleted_at is null and u.email is distinct from $1`, [ENGINE_EMAIL])).rows;

export function startSignalAlerts() {
  async function step() {
    const [ideas, evidence] = await Promise.all([intel('/ideas?limit=100'), intel('/evidence')]);
    const now = Date.now();
    for (const i of ideas) {
      if (i.kind !== 'idea' || i.status !== 'open' || new Date(i.enter_until).getTime() <= now) continue;
      if (i.asset_class.startsWith('crypto')) continue;   // test signals stay inside the app: they are frequent and unproven
      if (!await claimAlert(`idea:${i.id}`)) continue;
      const { rows } = await pool.query('select name from assets where id = $1', [i.asset_id]);
      const proven = evidence.groups?.[i.asset_class]?.status === 'proven';
      const tf = i.tf === '1d' ? 86400 : i.tf === '4h' ? 14400 : 3600;
      for (const u of await everyone()) {
        await notify(u.id, 'activities', `New signal: ${rows[0]?.name ?? i.asset_id}, ${i.direction > 0 ? 'Up' : 'Down'}`,
          `${proven ? '' : 'Experimental, not yet proven. '}It can lose. Open it to see the plan.`,
          `/terminal?asset=${encodeURIComponent(i.asset_id)}&mode=forex&signal=${i.id}&tf=${tf}`, { outside: true });
      }
    }
    for (const [cls, g] of Object.entries(evidence.groups ?? {})) {
      if (!g.paused || !await claimAlert(`pause:${cls}`)) continue;
      for (const u of await everyone()) await notify(u.id, 'activities', `${g.label} signals paused`, g.paused, '/scanner?tab=record', { outside: true });
    }
  }
  const run = () => step().catch((err) => { if (err.status !== 503) console.error('signal alerts', err.message); });
  setTimeout(run, 30_000);
  setInterval(run, 60_000);
}

export const intelRouter = Router();

const pass = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

intelRouter.get('/scan', pass(() => intel('/scan')));
intelRouter.get('/evidence', pass(() => intel('/evidence')));
intelRouter.get('/ai', pass(async () => {
  const { rows: finished } = await pool.query(
    `select t.* from intel.paper_trades p join trades t on t.id = p.trade_id where t.status = 'closed' order by t.close_time desc limit 5`);
  const [report, paper, scan, { rows: positions }] = await Promise.all([intel('/ai'), paperStats(), intel('/scan'), pool.query(
    `select t.*, i.id as idea_id, i.kind, i.strategy, i.tf, i.reasons, i.stop as stop_price, i.target as target_price, i.expires_at as ends_at, d.details as checked
     from intel.paper_trades p join trades t on t.id = p.trade_id join intel.ideas i on i.id = p.idea_id left join intel.ai_decisions d on d.idea_id = i.id
     where t.status = 'open' order by t.open_time desc`)]);
  const count = (s) => (scan.markets ?? []).filter((m) => m.status === s).length;
  return {
    ...report, stake: paper.stake, leverage: paper.leverage, open: positions.length, finished_trades: finished,
    positions: positions.map((t) => ({ ...t, reasons: (t.reasons ?? []).filter((x) => !x.startsWith('LightGBM')) })),
    watching: { scanned_at: scan.scanned_at, markets: (scan.markets ?? []).length, signals: count('trade'), setups_skipped: count('avoid'), waiting: count('wait') },
  };
}));
intelRouter.get('/performance', pass(async () => ({ ...(await intel('/performance')), paper: await paperStats() })));
intelRouter.get('/asset/:id', pass((req) => intel(`/asset/${encodeURIComponent(req.params.id)}`)));

// Ideas + whether this user took each one, by the trade's own link to the signal. The model's percentage stays out:
// the harder test showed it cannot be trusted, so users see the measured range instead (/intel/evidence).
intelRouter.get('/ideas', pass(async (req) => {
  const ideas = await intel(`/ideas?limit=${Math.min(Number(req.query.limit) || 100, 300)}`);
  const { rows: trades } = await pool.query(
    'select idea_id, id, status, result, pnl, amount from trades where user_id = $1 and idea_id = any($2::bigint[])', [req.user.id, ideas.map((i) => i.id)]);
  return ideas.map(({ probability: _p, ev_per_100: _ev, ...i }) => {
    const t = trades.find((tr) => Number(tr.idea_id) === i.id);
    return { ...i, reasons: i.reasons.filter((x) => !x.startsWith('LightGBM')), taken: t ? { trade_id: t.id, status: t.status, result: t.result, pnl: t.pnl, amount: t.amount } : null };
  });
}));

// ── One signal, ready to trade ──
// The plan and the placing both work from the server's own price and balance. Demo accounts only, whatever else is
// switched on: signals are for practice and learning until a lawyer and a licensed feed say otherwise.
export function signalRouter({ engine, settlement, orders }) {
  const r = Router();

  async function load(req, accountId, amount) {
    if (!isUuid(accountId)) throw Object.assign(new Error('Choose an account.'), { status: 400 });
    const ideas = await intel('/ideas?limit=300');
    const idea = ideas.find((i) => String(i.id) === req.params.id && i.kind === 'idea');
    if (!idea) throw Object.assign(new Error('This signal is no longer available.'), { status: 404 });
    if (!engine.has(idea.asset_id)) throw Object.assign(new Error('This market is not available in the app.'), { status: 400 });
    const tick = engine.getPrice(idea.asset_id);
    if (!tick) throw Object.assign(new Error('No price is available for this asset right now.'), { status: 400 });
    const { rows: acc } = await pool.query('select id, type, balance from accounts where id = $1 and user_id = $2', [accountId, req.user.id]);
    if (!acc[0]) throw Object.assign(new Error('Account not found.'), { status: 400 });
    if (acc[0].type !== 'DEMO') throw Object.assign(new Error('Signals are for your demo account only. Switch to demo to see this plan.'), { status: 403 });
    const balance = Number(acc[0].balance);
    if (amount != null && !(typeof amount === 'number' && Number.isFinite(amount) && amount >= 1)) throw Object.assign(new Error('Enter an amount of at least 1.'), { status: 400 });
    if (amount != null && amount > balance) throw Object.assign(new Error('That is more than your balance.'), { status: 400 });
    const [{ rows: assets }, { rows: trades }, { rows: pending }] = await Promise.all([
      pool.query('select max_leverage, payout_fixed, payout_inzone from assets where id = $1', [idea.asset_id]),
      pool.query('select id, status, result, pnl from trades where user_id = $1 and account_id = $2 and idea_id = $3 order by open_time desc limit 1', [req.user.id, accountId, idea.id]),
      pool.query(`select id from pending_orders where user_id = $1 and account_id = $2 and idea_id = $3 and status = 'pending' limit 1`, [req.user.id, accountId, idea.id]),
    ]);
    const plan = (QUICK[idea.asset_class] ? fixedTimePlan : signalPlan)({
      mode: QUICK[idea.asset_class], idea, price: tick.price, live: engine.isLive(idea.asset_id), balance, amount,
      maxLeverage: Number(assets[0]?.max_leverage) || 1, payout: Number(QUICK[idea.asset_class] === 'inzone' ? assets[0]?.payout_inzone : assets[0]?.payout_fixed) || 0, trade: trades[0] ?? null, order: pending[0] ?? null,
    });
    return { ...plan, idea };
  }

  const reply = (res, err) => {
    res.status(err.status || 400).json({ error: err.status ? err.message : messageFor(err.message) });
  };

  // The user's choice for each kind of money, and on demo the trades waiting for their OK.
  async function autoState(userId) {
    const { rows } = await pool.query('select scope, mode, amount, risk_accepted_at from auto_trade_settings where user_id = $1', [userId]);
    const of = (scope) => {
      const s = rows.find((x) => x.scope === scope);
      return { mode: s?.mode ?? AUTO_DEFAULTS[scope], amount: s ? Number(s.amount) : AUTO_MIN, riskAccepted: !!s?.risk_accepted_at };
    };
    const demo = of('demo');
    // The choice itself never depends on the engine: if it is busy or restarting, there is simply nothing to approve yet.
    const waiting = demo.mode === 'ask' ? await waitingFor(userId).catch((err) => {
      console.error('trades waiting for an OK', err.message);
      return [];
    }) : [];
    return { min: AUTO_MIN, demo, real: of('real'), waiting };
  }

  async function waitingFor(userId) {
    const now = Date.now();
    const { groups } = await intel('/evidence');
    const ideas = (await intel('/ideas?limit=200')).filter((i) => i.kind === 'idea' && i.status === 'open' && new Date(i.enter_until).getTime() > now && engine.isLive(i.asset_id) && earnsInTests(groups, i.asset_class));
    const ids = ideas.map((i) => i.id);
    const [{ rows: decided }, { rows: mine }] = await Promise.all([
      pool.query('select idea_id from intel.ai_decisions where take and idea_id = any($1::bigint[])', [ids]),
      pool.query('select idea_id from trades where user_id = $1 and idea_id = any($2::bigint[])', [userId, ids]),
    ]);
    const allowed = new Set(decided.map((d) => Number(d.idea_id)));
    const taken = new Set(mine.map((t) => Number(t.idea_id)));
    return ideas.filter((i) => allowed.has(i.id) && !taken.has(i.id))
      .map((i) => ({ id: i.id, asset_id: i.asset_id, asset_class: i.asset_class, direction: i.direction, enter_until: i.enter_until }));
  }

  r.get('/auto', async (req, res) => {
    try { res.json(await autoState(req.user.id)); } catch (err) { reply(res, err); }
  });

  r.put('/auto', async (req, res) => {
    try {
      const { scope, mode, amount, acceptRisk } = req.body ?? {};
      if (scope !== 'demo' && scope !== 'real') return res.status(400).json({ error: 'Choose demo or real.' });
      if (mode != null && mode !== 'ask' && mode !== 'auto') return res.status(400).json({ error: 'Choose always ask or auto trade.' });
      if (amount != null && !(typeof amount === 'number' && Number.isFinite(amount) && amount >= AUTO_MIN && amount <= AUTO_MAX)) return res.status(400).json({ error: `The amount must be at least ${AUTO_MIN}.` });
      const { rows } = await pool.query('select risk_accepted_at from auto_trade_settings where user_id = $1 and scope = $2', [req.user.id, scope]);
      if (scope === 'real' && mode === 'auto' && !acceptRisk && !rows[0]?.risk_accepted_at) return res.status(400).json({ error: 'Accept the risk first: the AI can lose your money.' });
      await pool.query(
        `insert into auto_trade_settings (user_id, scope, mode, amount, risk_accepted_at) values ($1, $2, coalesce($3::text, $6::text), coalesce($4::numeric, $7::numeric), case when $5::boolean then now() end)
         on conflict (user_id, scope) do update set mode = coalesce($3::text, auto_trade_settings.mode), amount = coalesce($4::numeric, auto_trade_settings.amount),
           risk_accepted_at = case when $5::boolean then now() else auto_trade_settings.risk_accepted_at end, updated_at = now()`,
        [req.user.id, scope, mode ?? null, amount != null ? Math.round(amount * 100) / 100 : null, scope === 'real' && !!acceptRisk, AUTO_DEFAULTS[scope], AUTO_MIN]);
      res.json(await autoState(req.user.id));
    } catch (err) { reply(res, err); }
  });

  r.get('/signals/:id/plan', async (req, res) => {
    try {
      const amount = req.query.amount != null ? Number(req.query.amount) : undefined;
      const { idea: _idea, ...plan } = await load(req, req.query.accountId, amount);
      res.json(plan);
    } catch (err) { reply(res, err); }
  });

  r.post('/signals/:id/take', async (req, res) => {
    try {
      const { accountId, amount } = req.body ?? {};
      const plan = await load(req, accountId, amount);
      // the safety stop also blocks a signal that was already on screen
      const group = (await intel('/evidence')).groups?.[plan.idea.asset_class];
      if (!group || group.status === 'blocked' || group.paused) return res.status(409).json({ error: group?.paused ?? 'This signal is no longer available.' });
      if (plan.status !== 'start' && plan.status !== 'wait') return res.status(409).json({ error: 'This signal can no longer be placed.' });
      if (plan.tooSmall) return res.status(400).json({ error: 'Your balance is too small for this plan at a safe size.' });
      if (plan.mode !== 'forex') {
        const trade = await openTrade({
          userId: req.user.id, engine, settlement,
          order: { accountId, assetId: plan.assetId, mode: plan.mode, direction: plan.direction, amount: plan.amount, durationSec: plan.durationSec, ideaId: plan.ideaId },
        });
        return res.status(201).json({ waiting: false, trade });
      }
      if (plan.status === 'start') {
        const trade = await openTrade({
          userId: req.user.id, engine, settlement,
          order: { accountId, assetId: plan.assetId, mode: 'forex', direction: plan.direction, amount: plan.amount, leverage: plan.leverage, takeProfit: plan.targetMoney, stopLoss: plan.stopMoney, ideaId: plan.ideaId, ideaEndsAt: plan.holdUntil },
        });
        return res.status(201).json({ waiting: false, trade });
      }
      // wait: the order fills at the entry price and cancels itself at the end of the entry window
      const { rows } = await pool.query(
        `insert into pending_orders (user_id, account_id, asset_id, mode, direction, amount, leverage, trigger_price, trigger_when, expires_at, take_profit, stop_loss, idea_id, idea_ends_at)
         values ($1, $2, $3, 'forex', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning *`,
        [req.user.id, accountId, plan.assetId, plan.direction, plan.amount, plan.leverage, plan.entry, plan.entry > plan.price ? 'above' : 'below', plan.enterUntil, plan.targetMoney, plan.stopMoney, plan.ideaId, plan.holdUntil]);
      orders.add(rows[0]);
      res.status(201).json({ waiting: true, order: rows[0] });
    } catch (err) { reply(res, err); }
  });

  return r;
}
