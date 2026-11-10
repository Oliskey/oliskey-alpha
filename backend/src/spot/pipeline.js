// AI Spot decision pipeline (docs/spot/SPEC.md Parts G, I, L, M):
//   validate proposal -> strategy eligibility (registry) -> entry timing -> Risk Manager -> execution -> journal
// Every stage's verdict is written into one TradingDecision record, accepted or not.
// Only strategies the lab marked APPROVED_FOR_PAPER may trade, and only on the paper adapter.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateTradeProposal } from './contracts.js';
import { DEFAULT_LIMITS, evaluate } from './risk.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REGISTRY_PATHS = [join(ROOT, 'intel', 'models', 'spot_registry.json'), join(ROOT, 'docs', 'intel', 'spot_registry.json')];

export function loadRegistry(paths = REGISTRY_PATHS) {
  for (const p of paths) if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  return { strategies: [], mode_allowed: 'none' };
}

const symKey = (s) => s.replace('/', '');

/** Is this strategy version allowed to trade this symbol in this mode? Live is never allowed from here. */
export function eligibility(registry, { strategyId, strategyVersion, symbol }, mode = 'paper') {
  if (mode !== 'paper') return { ok: false, reason: 'live trading is not enabled for AI Spot' };
  const sym = symKey(symbol);
  // A per-coin verdict wins; otherwise a basket verdict covers the coins it was tested on.
  const row = registry.strategies?.find((r) => r.strategy_id === strategyId && r.version === strategyVersion && r.symbol === sym)
    ?? registry.strategies?.find((r) => r.strategy_id === strategyId && r.version === strategyVersion && r.symbol === 'BASKET' && r.coins?.includes(sym));
  if (!row) return { ok: false, reason: 'strategy version not in the registry' };
  if (row.verdict !== 'APPROVED_FOR_PAPER') return { ok: false, reason: `strategy ${row.verdict} by the lab` };
  return { ok: true };
}

/** Entry timing (Part I): first failing check decides. market = { bid, ask, atr, now } */
export function entryTiming(p, market, { maxSpread = 0.001, maxChaseAtr = 0.5 } = {}) {
  const now = market.now ?? new Date();
  if (Date.parse(p.expiresAt) <= now.getTime()) return { decision: 'NO_TRADE', reason: 'signal expired' };
  if (Date.parse(p.candleCloseAt) > now.getTime()) return { decision: 'WAIT_FOR_CANDLE_CLOSE', reason: 'signal candle not closed' };
  if (!(market.bid > 0 && market.ask >= market.bid)) return { decision: 'REJECT_ENTRY', reason: 'no valid quote' };
  const mid = (market.bid + market.ask) / 2;
  if ((market.ask - market.bid) / mid > maxSpread) return { decision: 'REJECT_ENTRY', reason: 'spread too wide' };
  if (market.ask - p.entryPrice > maxChaseAtr * market.atr) return { decision: 'WAIT_FOR_PULLBACK', reason: 'price ran away from the signal' };
  if (market.ask <= p.stopLoss) return { decision: 'REJECT_ENTRY', reason: 'price already at or below the stop' };
  return { decision: 'ENTER_NOW' };
}

export async function decide({ proposal, account, market, killSwitch, exchange, registry = loadRegistry(), limits = DEFAULT_LIMITS, mode = 'paper', journal = () => {} }) {
  const d = { decisionId: randomUUID(), proposalId: proposal?.proposalId ?? null, strategyVersion: proposal?.strategyVersion ?? null,
    timestamps: { received: new Date().toISOString() }, supervisor: null, entryTiming: null, risk: null, execution: null, finalStatus: 'PENDING' };
  const done = (status) => { d.finalStatus = status; d.timestamps.decided = new Date().toISOString(); journal(d); return d; };

  const v = validateTradeProposal(proposal);
  if (!v.ok) { d.supervisor = { status: 'REJECTED', reasons: v.errors.map((e) => `invalid: ${e}`) }; return done('REJECTED'); }
  if (proposal.action !== 'OPEN_LONG') { d.supervisor = { status: 'REJECTED', reasons: ['only OPEN_LONG proposals enter here'] }; return done('REJECTED'); }
  const el = eligibility(registry, proposal, mode);
  if (!el.ok) { d.supervisor = { status: 'REJECTED', reasons: [el.reason] }; return done('REJECTED'); }
  d.supervisor = { status: 'ACCEPTED', reasons: [] };

  const t = entryTiming(proposal, market);
  d.entryTiming = t.decision;
  if (t.decision === 'NO_TRADE') return done('EXPIRED');
  if (t.decision !== 'ENTER_NOW') { d.supervisor.reasons.push(t.reason); return done(t.decision.startsWith('WAIT') ? 'DEFERRED' : 'REJECTED'); }

  const r = evaluate({ proposal: { ...proposal, entryPrice: market.ask }, account, limits, killSwitch, now: market.now ?? new Date() });
  d.risk = { status: r.status, qty: r.qty, actualRisk: r.actualRisk, rulesFailed: r.rulesFailed, riskConfigVersion: r.riskConfigVersion };
  if (r.status !== 'APPROVED') return done('REJECTED');

  // Execution: entry, then a protective stop sized to what actually filled.
  const o = r.order;
  const entry = exchange.placeOrder({ clientOrderId: o.clientOrderId, symbol: o.symbol, side: 'BUY', type: 'MARKET', qty: o.qty });
  if (!['FILLED', 'PARTIALLY_FILLED'].includes(entry.status)) { d.execution = { status: 'REJECTED', reason: entry.reason }; return done('REJECTED'); }
  const stop = exchange.placeOrder({ clientOrderId: `${o.clientOrderId}-sl`, symbol: o.symbol, side: 'SELL', type: 'STOP_MARKET', qty: entry.filledQty, stopPrice: o.stopLoss });
  d.execution = { status: 'EXECUTED', orderId: entry.venueOrderId, filledQty: entry.filledQty, avgPrice: entry.avgPrice, stopOrderId: stop.venueOrderId, stopStatus: stop.status };
  if (entry.status === 'PARTIALLY_FILLED') exchange.cancel(o.clientOrderId);
  return done('EXECUTED');
}
