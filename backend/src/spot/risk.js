// AI Spot Risk Manager (docs/spot/SPEC.md Part L). Deterministic: no AI, no randomness, no network.
// It is the only code that turns a TradeProposal into an ApprovedOrder. Every rule below fails closed:
// if anything needed for the decision is missing or invalid, the answer is REJECTED.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Illustrative defaults from the spec; the owner sets the real values. Lower is always allowed.
export const DEFAULT_LIMITS = Object.freeze({
  version: 'risk-2026-11-09',
  maxRiskPerTrade: 0.01,          // 1% of equity
  maxOpenRisk: 0.03,              // 3% of equity at risk across open positions
  maxDailyLoss: 0.03,             // 3% of start-of-day equity, realised + unrealised - costs
  maxDrawdown: 0.10,              // from peak equity -> kill switch
  maxExposure: 0.60,              // notional / equity
  maxOpenPositions: 4,
  maxStrategyRisk: 0.015,
  maxCorrelatedRisk: 0.02,        // BTC and ETH longs move together: one cluster
  maxOrdersPerHour: 20,
  maxOrdersPerDay: 60,
  takerFee: 0.001,
  slippage: 0.0002,
  stopSlippageBuffer: 0.0005,
  feeBuffer: 0.002,
});

// Exchange filters (Binance spot style). The adapter refreshes these from the venue; these are safe fallbacks.
export const DEFAULT_FILTERS = Object.freeze({
  'BTC/USDT': { tickSize: 0.01, stepSize: 0.00001, minQty: 0.00001, minNotional: 5 },
  'ETH/USDT': { tickSize: 0.01, stepSize: 0.0001, minQty: 0.0001, minNotional: 5 },
});

const EPS = 1e-12;
export const floorToStep = (x, step) => Math.floor((x + EPS) / step) * step;
const decimals = (step) => Math.max(0, -Math.floor(Math.log10(step) + EPS));
export const roundQty = (x, step) => Number(floorToStep(x, step).toFixed(decimals(step)));
export const roundPrice = (x, tick) => Number((Math.round(x / tick) * tick).toFixed(decimals(tick)));

/**
 * Position size for a long spot entry. Returns { qty, actualRisk, notional } or { reject: reason }.
 * actualRisk is recomputed from the FINAL quantity and can never exceed the permitted amount.
 */
export function sizeLong({ equity, availableQuote, exposureHeadroom, riskFraction, entry, stop, limits = DEFAULT_LIMITS, filters }) {
  if (!(equity > 0) || !(entry > 0) || !(stop > 0) || !filters) return { reject: 'missing sizing input' };
  if (!(stop < entry)) return { reject: 'stop must be below entry for a long' };
  const riskAmount = equity * Math.min(riskFraction, limits.maxRiskPerTrade);
  if (!(riskAmount > 0)) return { reject: 'no risk budget' };
  const entryEff = entry * (1 + limits.slippage + limits.takerFee);
  const stopEff = stop * (1 - limits.stopSlippageBuffer - limits.takerFee);
  const riskPerUnit = entryEff - stopEff;
  if (!(riskPerUnit > 0)) return { reject: 'stop too close after costs' };
  const byRisk = riskAmount / riskPerUnit;
  const byCash = Math.max(0, availableQuote) * (1 - limits.feeBuffer) / entryEff;
  const byExposure = Math.max(0, exposureHeadroom) / entryEff;
  const qty = roundQty(Math.min(byRisk, byCash, byExposure), filters.stepSize);
  if (qty < filters.minQty) return { reject: `quantity below exchange minimum (${filters.minQty})` };
  if (qty * entry < filters.minNotional) return { reject: `order value below exchange minimum (${filters.minNotional})` };
  const actualRisk = qty * riskPerUnit;
  if (actualRisk > riskAmount + 1e-9) return { reject: 'rounding would add risk' };
  return { qty, actualRisk, riskAmount, notional: qty * entry, riskPerUnit };
}

/** Persistent, auditable kill switch. Set by limits or a person; cleared ONLY by a person with a reason. */
export class KillSwitch {
  constructor(file) {
    this.file = file;
    this.state = { on: false, reason: null, setBy: null, setAt: null };
    if (file && existsSync(file)) this.state = JSON.parse(readFileSync(file, 'utf8'));
  }
  get on() { return this.state.on; }
  #save(event) {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.state, null, 2));
    appendFileSync(`${this.file}.log`, `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`);
  }
  trip(reason, setBy = 'risk') {
    if (this.state.on) return;
    this.state = { on: true, reason, setBy, setAt: new Date().toISOString() };
    this.#save({ action: 'trip', reason, by: setBy });
  }
  clear({ by, reason }) {
    if (!by || by === 'risk' || by === 'timer' || !reason) throw new Error('only a person, with a reason, can clear the kill switch');
    this.state = { on: false, reason: null, setBy: null, setAt: null };
    this.#save({ action: 'clear', reason, by });
  }
}

/**
 * Evaluate a validated OPEN_LONG proposal against the account. Pure apart from tripping the kill switch.
 * account: { equity, peakEquity, dayStartEquity, dayPnl, availableQuote, exposure, openRisk, openPositions,
 *            strategyRisk: {id: n}, ordersLastHour, ordersToday }
 */
export function evaluate({ proposal, account, limits = DEFAULT_LIMITS, filters = DEFAULT_FILTERS, killSwitch, now = new Date(), riskFraction }) {
  const fail = (...rules) => ({ status: 'REJECTED', rulesFailed: rules, riskConfigVersion: limits.version });
  if (!killSwitch) return fail('no kill switch: fail closed');
  if (killSwitch.on) return fail(`kill switch on: ${killSwitch.state.reason}`);
  if (!proposal || proposal.action !== 'OPEN_LONG') return fail('risk only approves OPEN_LONG entries; exits go through exitOrder()');
  const f = filters[proposal.symbol];
  if (!f) return fail('unknown symbol');
  if (Date.parse(proposal.expiresAt) <= now.getTime()) return fail('proposal expired');
  const a = account ?? {};
  for (const k of ['equity', 'peakEquity', 'dayStartEquity', 'dayPnl', 'availableQuote', 'exposure', 'openRisk', 'openPositions']) {
    if (!Number.isFinite(a[k])) return fail(`account.${k} missing`);
  }
  // Account-level breaches trip the kill switch (persistent; a timer never clears it).
  const drawdown = 1 - a.equity / a.peakEquity;
  if (drawdown >= limits.maxDrawdown) { killSwitch.trip(`drawdown ${(drawdown * 100).toFixed(2)}% >= ${limits.maxDrawdown * 100}%`); return fail('max drawdown reached'); }
  const dayLoss = -a.dayPnl / a.dayStartEquity;
  if (dayLoss >= limits.maxDailyLoss) { killSwitch.trip(`daily loss ${(dayLoss * 100).toFixed(2)}% >= ${limits.maxDailyLoss * 100}%`); return fail('daily loss limit reached'); }

  const rules = [];
  if (a.openPositions >= limits.maxOpenPositions) rules.push('max open positions');
  if ((a.ordersLastHour ?? 0) >= limits.maxOrdersPerHour) rules.push('max orders per hour');
  if ((a.ordersToday ?? 0) >= limits.maxOrdersPerDay) rules.push('max orders per day');
  const entry = roundPrice(proposal.entryPrice, f.tickSize);
  const stop = roundPrice(proposal.stopLoss, f.tickSize);
  if (!(stop < entry)) rules.push('stop must be below entry');
  if (!(proposal.takeProfit > entry)) rules.push('target must be above entry');
  if (rules.length) return fail(...rules);

  const strategyUsed = a.strategyRisk?.[proposal.strategyId] ?? 0;
  const headroom = Math.min(
    limits.maxOpenRisk * a.equity - a.openRisk,
    limits.maxStrategyRisk * a.equity - strategyUsed,
    limits.maxCorrelatedRisk * a.equity - a.openRisk,               // BTC+ETH longs = one cluster
    (limits.maxDailyLoss * a.dayStartEquity + a.dayPnl),              // this trade's loss must fit today's limit
  );
  const wanted = Math.min(riskFraction ?? limits.maxRiskPerTrade, limits.maxRiskPerTrade);
  const fraction = Math.min(wanted, headroom / a.equity);
  if (!(fraction > 0)) return fail('no risk headroom left');
  const size = sizeLong({ equity: a.equity, availableQuote: a.availableQuote, exposureHeadroom: limits.maxExposure * a.equity - a.exposure,
    riskFraction: fraction, entry, stop, limits, filters: f });
  if (size.reject) return fail(size.reject);
  // Net reward-to-risk after costs must still be positive.
  const netReward = size.qty * (proposal.takeProfit * (1 - limits.takerFee) - entry * (1 + limits.takerFee + limits.slippage));
  if (!(netReward > 0)) return fail('no reward after costs');
  return {
    status: 'APPROVED', rulesFailed: [], riskConfigVersion: limits.version,
    order: { clientOrderId: `ox-${proposal.proposalId}`, symbol: proposal.symbol, side: 'BUY', qty: size.qty, refPrice: entry,
      stopLoss: stop, takeProfit: roundPrice(proposal.takeProfit, f.tickSize), riskConfigVersion: limits.version,
      strategyId: proposal.strategyId, strategyVersion: proposal.strategyVersion },
    qty: size.qty, actualRisk: size.actualRisk, permittedRisk: size.riskAmount, netRewardRisk: netReward / size.actualRisk,
  };
}

/** Exits are never blocked by the kill switch, but can never sell more than is held (no accidental short). */
export function exitOrder({ position, reason, filters = DEFAULT_FILTERS }) {
  const f = filters[position.symbol];
  const qty = roundQty(position.qty, f.stepSize);
  if (!(qty > 0)) return { status: 'REJECTED', rulesFailed: ['nothing to sell'] };
  return { status: 'APPROVED', order: { clientOrderId: `ox-exit-${position.id}-${reason}`, symbol: position.symbol, side: 'SELL', qty: Math.min(qty, position.qty), refPrice: position.lastPrice, riskConfigVersion: 'exit' } };
}
