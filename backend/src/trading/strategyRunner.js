// The four AI Trading strategies, driven by the AI Spot agents (intel/engine/spot/agents.py) and the lab gates.
// PRACTICE ONLY: orders go through placeStrategyOrder, and only for allocations on testnet connections; live connections are
// never touched here (REAL-MONEY GATE). The risk engine still decides every order: an unapproved strategy version or a
// missing subscription is refused and recorded, never bypassed.
//
// Rules (fixed before any result; docs/ai-trading/STRATEGIES.md):
//   scalping strategies follow the agents' 15-minute decisions, swing strategies their 4-hour decisions;
//   STRICT acts only when the lab approved the chosen strategy for paper on that exact coin;
//   BALANCED also accepts an approval from the unseen-coins basket that includes the coin.
//   A buy needs a TRADE decision made in the last 10 minutes and a fresh real price (at most 30 s old, read from Binance's
//   public price) no more than 0.5% above the agents' planned entry. Sells follow the agents' own exit: when their paper
//   trade for that order closes, a sell signal is written and holdings from that buy are sold.
// Every decision, taken or not, is kept in trading.agent_decisions with the reason.
import { pool } from '../db.js';
import { adapterFor } from './exchanges/index.js';
import { placeStrategyOrder } from './service.js';
import { D, cmp, mul, add, str } from './decimal.js';
import { eligibility, loadRegistry } from '../spot/pipeline.js';

export const VERSION = '0.1.0';
export const RULES = {
  strict_scalping: { timeframe: '15m', gate: 'coin' },
  balanced_scalping: { timeframe: '15m', gate: 'coin_or_basket' },
  strict_swing: { timeframe: '4h', gate: 'coin' },
  balanced_swing: { timeframe: '4h', gate: 'coin_or_basket' },
};
const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
export const MAX_DECISION_AGE_MS = 10 * 60_000;
export const MAX_PRICE_AGE_MS = 30_000;
export const MAX_CHASE = '0.005';
const SIGNAL_LIFE_MS = 5 * 60_000;
const EVERY_MS = 60_000;

const viewOf = (row, agent) => (row.agents || []).find((v) => v.agent === agent);
/** "trend_breakout|0.1.0|BTCUSDT|2026-…" → { id, version } */
const pickOf = (row) => { const [id, version] = String(row.order_id || '').split('|'); return id && version ? { id, version } : null; };
/** a decimal string from a number the agents stored; never trusted as money, only as a planned level */
const level = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v.toFixed(8) : null);

/** Which lab approval covers this pick on this coin: 'coin', 'basket' or null. */
export function approvalScope(registry, pick, symbol) {
  if (!pick) return null;
  const el = eligibility(registry, { strategyId: pick.id, strategyVersion: pick.version, symbol }, 'paper');
  if (!el.ok) return null;
  const own = registry.strategies?.some((r) => r.strategy_id === pick.id && r.version === pick.version && r.symbol === symbol && r.verdict === 'APPROVED_FOR_PAPER');
  return own ? 'coin' : 'basket';
}

/**
 * One strategy's answer to one agents' decision. Pure: given the decision row, the registry, a fresh price and the time.
 * Returns { decision: 'trade'|'wait'|'skip'|'veto', explanation, plan? }.
 */
export function decide(strategyId, row, { registry, price, now }) {
  const rule = RULES[strategyId];
  if (row.decision === 'WAIT') return { decision: 'wait', explanation: 'The agents asked to wait.' };
  if (row.decision !== 'TRADE') {
    const blockers = viewOf(row, 'collaboration')?.data?.blockers ?? [];
    return blockers.length ? { decision: 'veto', explanation: `Blocked by ${blockers.join(', ')}.` } : { decision: 'skip', explanation: 'No trade signal.' };
  }
  const pick = pickOf(row);
  const scope = approvalScope(registry, pick, row.symbol);
  if (!scope) return { decision: 'skip', explanation: 'The lab has not approved this strategy for paper on this coin.' };
  if (rule.gate === 'coin' && scope !== 'coin') return { decision: 'skip', explanation: 'Strict: approved only through the basket, not on this coin itself.' };
  const decidedAge = now - new Date(row.decided_at).getTime();
  if (!(decidedAge >= 0 && decidedAge <= MAX_DECISION_AGE_MS)) return { decision: 'skip', explanation: 'The decision is too old to act on.' };
  const plan = viewOf(row, 'exit')?.data ?? {};
  const entry = level(plan.entry), stop = level(plan.stop), target = level(plan.target);
  if (!entry || !stop) return { decision: 'skip', explanation: 'No complete exit plan.' };
  const age = price ? now - price.time : Infinity;
  if (!price || !(age >= 0 && age <= MAX_PRICE_AGE_MS)) return { decision: 'skip', explanation: 'No fresh price: never trade on stale data.' };
  if (cmp(price.price, add(entry, mul(entry, MAX_CHASE))) > 0) return { decision: 'skip', explanation: 'The price already ran past the plan.' };
  if (cmp(price.price, stop) <= 0) return { decision: 'skip', explanation: 'The price is already at or below the stop.' };
  return { decision: 'trade', explanation: `Following the agents: ${pick.id} ${pick.version}, lab approval on ${scope === 'coin' ? 'this coin' : 'the basket'}.`, plan: { entry, stop, target, pick } };
}

async function ensureVersions(client) {
  for (const [id, rule] of Object.entries(RULES)) {
    // created as 'testing': only an admin can approve a version, with evidence (approval centre)
    await client.query(`insert into trading.strategy_versions (strategy_id, version, config, status) values ($1, $2, $3, 'testing')
      on conflict (strategy_id, version) do nothing`, [id, VERSION, { follows: 'ai_spot_agents', ...rule, symbols: SYMBOLS, maxChase: MAX_CHASE, exits: 'agents' }]);
  }
  const { rows } = await client.query('select id, strategy_id from trading.strategy_versions where version = $1 and strategy_id = any($2)', [VERSION, Object.keys(RULES)]);
  return Object.fromEntries(rows.map((r) => [r.strategy_id, r.id]));
}

/** Orders for every testnet allocation of this strategy. Live allocations are never traded here. */
async function placeForAllocations({ client, strategyId, signal, side, deps }) {
  const { rows } = await client.query(
    `select a.user_id, a.amount, p.quantity from trading.strategy_allocations a
       join trading.exchange_connections c on c.id = a.connection_id and c.revoked_at is null and c.environment = 'testnet'
       left join trading.positions p on p.user_id = a.user_id and p.strategy_id = a.strategy_id and p.symbol = $2 and p.environment = 'testnet' and p.status = 'open'
      where a.strategy_id = $1 and a.status = 'active'`, [strategyId, signal.symbol]);
  const out = [];
  for (const r of rows) {
    if (side === 'sell' && !(r.quantity && D(r.quantity) > 0n)) continue;
    try {
      out.push(await (deps.placeOrder ?? placeStrategyOrder)({
        userId: r.user_id, strategyId, signalId: signal.id, symbol: signal.symbol, side,
        quoteAmount: side === 'buy' ? r.amount : undefined, quantity: side === 'sell' ? r.quantity : undefined,
        refPrice: signal.reference_price, priceTime: new Date(signal.price_time).getTime(), idempotencyKey: `sig:${signal.id}:${r.user_id}`,
      }, deps));
    } catch (e) { out.push({ placed: false, error: e.code || e.message }); }
  }
  return out;
}

/** One pass: new agent decisions → strategy decisions (+ buy signals), then exits for closed agent trades. */
export async function runOnce(deps = {}) {
  const { client = pool, now = Date.now, registry = loadRegistry(), price = defaultPrice() } = deps;
  const versions = await ensureVersions(client);
  const results = { decisions: 0, signals: 0, orders: 0 };
  const { rows: fresh } = await client.query(
    `select d.* from intel.spot_agent_decisions d
      where d.symbol = any($1) and d.decided_at > now() - interval '1 day'
        and not exists (select 1 from trading.agent_decisions a where a.agent = 'ai_spot_agents' and a.input->>'intel_decision' = d.id)
      order by d.decided_at`, [SYMBOLS]);
  const prices = {};
  for (const row of fresh) {
    for (const [strategyId, rule] of Object.entries(RULES)) {
      if (row.timeframe !== rule.timeframe) continue;
      if (row.decision === 'TRADE' && !prices[row.symbol]) prices[row.symbol] = await price(row.symbol).catch(() => null);
      const d = decide(strategyId, row, { registry, price: prices[row.symbol], now: now() });
      let signal = null;
      if (d.decision === 'trade') {
        ({ rows: [signal] } = await client.query(
          `insert into trading.trading_signals (strategy_version_id, symbol, side, reference_price, price_time, stop_price, target_price, reasons, valid_until)
           values ($1, $2, 'buy', $3, to_timestamp($4 / 1000.0), $5, $6, $7, now() + make_interval(secs => $8)) returning *`,
          [versions[strategyId], row.symbol, prices[row.symbol].price, prices[row.symbol].time, d.plan.stop, d.plan.target,
            { intel_decision: row.id, agents_order: row.order_id, lab: d.plan.pick }, SIGNAL_LIFE_MS / 1000]));
        results.signals++;
      }
      await client.query(`insert into trading.agent_decisions (agent, strategy_id, symbol, decision, input, output, explanation, signal_id)
        values ('ai_spot_agents', $1, $2, $3, $4, $5, $6, $7)`,
        [strategyId, row.symbol, d.decision, { intel_decision: row.id, timeframe: row.timeframe, agents_decision: row.decision },
          { plan: d.plan ? { entry: d.plan.entry, stop: d.plan.stop, target: d.plan.target } : null, price: d.decision === 'trade' ? prices[row.symbol] : null },
          d.explanation, signal?.id ?? null]);
      results.decisions++;
      if (signal) results.orders += (await placeForAllocations({ client, strategyId, signal, side: 'buy', deps })).filter((o) => o.placed).length;
    }
  }

  // exits: the agents closed their paper trade for a buy we signalled → sell signal (once) and sell those holdings
  const { rows: exits } = await client.query(
    `select s.*, v.strategy_id, t.exit_at, t.reason from trading.trading_signals s
       join trading.strategy_versions v on v.id = s.strategy_version_id
       join intel.spot_paper_trades t on t.id = s.reasons->>'agents_order'
      where s.side = 'buy' and t.status <> 'open' and t.exit_at is not null
        and not exists (select 1 from trading.trading_signals x where x.side = 'sell' and x.reasons->>'exit_of' = s.id::text)`);
  for (const b of exits) {
    const p = await price(b.symbol).catch(() => null);
    if (!p || !(now() - p.time <= MAX_PRICE_AGE_MS)) continue;   // never on stale data: tried again next pass
    const { rows: [sell] } = await client.query(
      `insert into trading.trading_signals (strategy_version_id, symbol, side, reference_price, price_time, reasons, valid_until)
       values ($1, $2, 'sell', $3, to_timestamp($4 / 1000.0), $5, now() + make_interval(secs => $6)) returning *`,
      [b.strategy_version_id, b.symbol, p.price, p.time, { exit_of: b.id, agents_reason: b.reason }, SIGNAL_LIFE_MS / 1000]);
    await client.query(`insert into trading.agent_decisions (agent, strategy_id, symbol, decision, input, output, explanation, signal_id)
      values ('ai_spot_agents', $1, $2, 'trade', $3, $4, $5, $6)`,
      [b.strategy_id, b.symbol, { exit_of: b.id }, { price: p }, `Sell: the agents closed their trade (${b.reason ?? 'exit'}).`, sell.id]);
    results.signals++;
    results.orders += (await placeForAllocations({ client, strategyId: b.strategy_id, signal: sell, side: 'sell', deps })).filter((o) => o.placed).length;
  }
  return results;
}

/** Binance's public spot price (no key), timed when it arrived. */
function defaultPrice() {
  const ex = adapterFor('binance', { environment: 'live' });
  return async (symbol) => { const r = await ex.price(symbol); return { price: String(r.price), time: Date.now() }; };
}

/** Leader only. Off with TRADING_STRATEGY_RUNNER=off; needs the intel tables (the AI engine). */
export function startStrategyRunner() {
  if (process.env.TRADING_STRATEGY_RUNNER === 'off') return;
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try { await runOnce(); } catch (e) { if (e.code !== '42P01') console.error('strategy runner', e.message); } finally { busy = false; }
  };
  setTimeout(tick, 20_000).unref();
  setInterval(tick, EVERY_MS).unref();
}

export const _test = { pickOf, level, str };
