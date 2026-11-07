// Turns an engine idea into a plan for one account: which trade type, when to start, how much, and where the trade
// ends in profit or loss. The server does this sum so the app never works out money. A suggested amount, not advice:
// ideas can lose.
//
// Live-priced markets use the idea's own levels. Simulated markets have their own price, so the plan keeps the idea's
// percentage distances from the app's current price and is marked simulated: practice only, the test results come from
// the real market and do not apply to a simulated chart.

export const RISK_SHARE = 0.01;     // a stop-out should cost about 1% of the balance
const MAX_STAKE_SHARE = 0.2;        // and never put more than 20% of the balance into one trade
const NEAR_SHARE = 0.25;            // "near entry" = within a quarter of the distance to the stop

const round2 = (v) => Math.round(v * 100) / 100;
const atLeastCent = (v) => Math.max(0.01, round2(v));

// A Fixed Time or InZone signal: no stop or target, the whole amount is what can be lost, so the suggested amount IS the 1%.
export function fixedTimePlan({ idea, price, balance, payout, amount, trade = null, now = Date.now(), mode = 'fixed_time' }) {
  const status = trade?.status === 'open' ? 'hold' : trade ? 'done' : idea.status !== 'open' || now > new Date(idea.enter_until).getTime() ? 'missed' : 'start';
  const suggested = Math.floor(balance * RISK_SHARE * 100) / 100;
  const tooSmall = suggested < 1;
  const suggestedAmount = tooSmall ? 1 : suggested;
  const chosen = amount ?? suggestedAmount;
  return {
    ideaId: idea.id, assetId: idea.asset_id, direction: mode === 'inzone' ? null : idea.direction > 0 ? 'up' : 'down', kind: idea.kind,
    mode, durationSec: Math.round((new Date(idea.expires_at).getTime() - new Date(idea.bar_time).getTime()) / 1000) || 3600, status, reason: status === 'missed' ? 'expired' : null, simulated: false,
    price, entry: price, stop: null, target: null, leverage: null, payout,
    suggestedAmount, amount: chosen, tooSmall,
    stopMoney: chosen, targetMoney: round2((chosen * payout) / 100), riskPct: balance > 0 ? round2((chosen / balance) * 100) : null,
    enterUntil: idea.enter_until, holdUntil: idea.expires_at,
    tradeId: trade?.id ?? null, orderId: null, result: trade?.result ?? null, pnl: trade?.pnl ?? null,
  };
}

export function signalPlan({ idea, price, live, balance, maxLeverage, amount, trade = null, order = null, now = Date.now() }) {
  const dir = idea.direction;
  const stopFrac = Math.abs(idea.entry - idea.stop) / idea.entry;
  const targetFrac = Math.abs(idea.target - idea.entry) / idea.entry;

  // Where the plan sits on this market's chart.
  const entry = live ? idea.entry : price;
  const stop = live ? idea.stop : price * (1 - dir * stopFrac);
  const target = live ? idea.target : price * (1 + dir * targetFrac);

  // What to do right now.
  let status, reason = null;
  const toTarget = dir * (target - price), toStop = dir * (price - stop);
  if (trade?.status === 'open') status = 'hold';
  else if (trade) status = 'done';
  else if (order) status = 'waiting_order';
  else if (idea.status !== 'open' || now > new Date(idea.enter_until).getTime()) { status = 'missed'; reason = 'expired'; }
  else if (live && toTarget <= 0) { status = 'missed'; reason = 'passed_target'; }
  else if (live && toStop <= 0) { status = 'missed'; reason = 'passed_stop'; }
  else if (live && Math.abs(price - entry) / entry > NEAR_SHARE * stopFrac) status = 'wait';
  else status = 'start';

  // Opening now measures from the current price; waiting measures from the entry price it will open at.
  const fromNow = live && status === 'start';
  const stopMove = fromNow ? toStop / price : stopFrac;
  const targetMove = fromNow ? toTarget / price : targetFrac;

  // Smallest multiplier that keeps the stake under its cap, within what this market allows.
  const risk = balance * RISK_SHARE;
  const leverage = Math.max(1, Math.min(maxLeverage, Math.ceil(risk / (stopMove * balance * MAX_STAKE_SHARE))));
  const suggested = Math.min(balance * MAX_STAKE_SHARE, risk / (leverage * stopMove));
  const tooSmall = suggested < 1;
  const suggestedAmount = tooSmall ? 1 : Math.floor(suggested * 100) / 100;
  const chosen = amount ?? suggestedAmount;
  const stopMoney = atLeastCent(chosen * leverage * stopMove);
  const targetMoney = atLeastCent(chosen * leverage * targetMove);

  return {
    ideaId: idea.id, assetId: idea.asset_id, direction: dir > 0 ? 'up' : 'down', kind: idea.kind,
    mode: 'forex',                  // the one trade type with a stop and a target, and no 4-hour limit
    status, reason, simulated: !live,
    price, entry, stop, target, leverage,
    suggestedAmount, amount: chosen, tooSmall,
    stopMoney, targetMoney, riskPct: balance > 0 ? round2((stopMoney / balance) * 100) : null,
    enterUntil: idea.enter_until, holdUntil: idea.expires_at,
    tradeId: trade?.id ?? null, orderId: order?.id ?? null, result: trade?.result ?? null, pnl: trade?.pnl ?? null,
  };
}
