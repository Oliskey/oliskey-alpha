// AI Spot data contracts (docs/spot/SPEC.md Part T). Plain validators, no dependencies.
// A record that fails validation is rejected and logged; it is never "best-effort" parsed.
// Spot is long-only: there is no action that opens a short.

export const SCHEMA_VERSION = '1.0';
export const ACTIONS = Object.freeze(['OPEN_LONG', 'CLOSE_LONG', 'HOLD']);
export const ENTRY_TIMING = Object.freeze(['ENTER_NOW', 'WAIT_FOR_PULLBACK', 'WAIT_FOR_BREAKOUT_CONFIRMATION',
  'WAIT_FOR_CANDLE_CLOSE', 'REJECT_ENTRY', 'NO_TRADE']);
export const FINAL_STATUS = Object.freeze(['ACCEPTED', 'REJECTED', 'DEFERRED', 'APPROVED', 'EXECUTED', 'EXPIRED', 'PENDING']);
export const SYMBOLS = Object.freeze(['BTC/USDT', 'ETH/USDT']);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPos = (v) => isNum(v) && v > 0;
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isTime = (v) => isStr(v) && !Number.isNaN(Date.parse(v));

export function validateTradeProposal(p) {
  const e = [];
  if (!p || typeof p !== 'object') return { ok: false, errors: ['not an object'] };
  if (p.schemaVersion !== SCHEMA_VERSION) e.push('schemaVersion');
  for (const k of ['proposalId', 'agentId', 'strategyId', 'strategyVersion', 'timeframe', 'reasoningSummary']) {
    if (!isStr(p[k])) e.push(k);
  }
  if (!SYMBOLS.includes(p.symbol)) e.push('symbol');
  if (!ACTIONS.includes(p.action)) e.push('action');
  for (const k of ['createdAt', 'expiresAt', 'candleCloseAt']) if (!isTime(p[k])) e.push(k);
  if (isTime(p.createdAt) && isTime(p.expiresAt) && Date.parse(p.expiresAt) <= Date.parse(p.createdAt)) e.push('expiresAt<=createdAt');
  if (p.action === 'OPEN_LONG') {
    for (const k of ['entryPrice', 'stopLoss', 'takeProfit']) if (!isPos(p[k])) e.push(k);
    if (isPos(p.entryPrice) && isPos(p.stopLoss) && !(p.stopLoss < p.entryPrice)) e.push('long: stopLoss must be below entryPrice');
    if (isPos(p.entryPrice) && isPos(p.takeProfit) && !(p.takeProfit > p.entryPrice)) e.push('long: takeProfit must be above entryPrice');
  }
  if (!p.confidence || !isNum(p.confidence.value) || p.confidence.value < 0 || p.confidence.value > 1 || typeof p.confidence.calibrated !== 'boolean') {
    e.push('confidence {value 0..1, calibrated}');
  }
  if (!Array.isArray(p.invalidationConditions)) e.push('invalidationConditions');
  if (!Array.isArray(p.supportingEvidence)) e.push('supportingEvidence');
  return { ok: e.length === 0, errors: e };
}

export function validateApprovedOrder(o) {
  const e = [];
  if (!o || typeof o !== 'object') return { ok: false, errors: ['not an object'] };
  if (!isStr(o.clientOrderId)) e.push('clientOrderId');
  if (!SYMBOLS.includes(o.symbol)) e.push('symbol');
  if (!['BUY', 'SELL'].includes(o.side)) e.push('side');
  if (!isPos(o.qty)) e.push('qty');
  if (o.side === 'BUY' && !isPos(o.stopLoss)) e.push('stopLoss required on a buy');
  if (!isPos(o.refPrice)) e.push('refPrice');
  if (!isStr(o.riskConfigVersion)) e.push('riskConfigVersion');
  return { ok: e.length === 0, errors: e };
}

// What a strategy may claim about confidence: an uncalibrated number is a "signal strength", never a probability.
export const confidenceLabel = (c) => (c?.calibrated ? 'probability' : 'signal strength');
