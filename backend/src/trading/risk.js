// Deterministic pre-trade risk engine for exchange orders. Every order, paper or live, passes here; an AI recommendation
// cannot skip it and nothing in here can be changed by an agent. All checks run (the full list is stored as the risk
// event), and the order is approved only if every check passes. Amounts are exact decimals.
import { D, add, sub, mul, div, cmp, floorToStep, str } from './decimal.js';

/**
 * proposal: { userId, strategyId, symbol, side, quoteAmount? (buy), quantity? (sell), refPrice, priceTime (ms), idempotencyKey }
 * ctx: {
 *   now (ms), controls: { platformPaused, emergencyStop, liveEnabled }, environment, exchangeLive (bool), userPaused,
 *   subscriptionActive, strategyApproved (version approved for this environment),
 *   limits: { maxOrderQuote, maxPositionQuote, maxDailyLossQuote, maxExposurePct, maxConcurrentPositions, maxSlippageBps, maxPriceAgeMs },
 *   allocation (USDT for this strategy), strategyExposure (USDT at cost already in this strategy),
 *   totalExposure (USDT at cost across strategies), equity (USDT total on the exchange), availableQuote (free USDT),
 *   holding (base quantity held by this strategy for the symbol), openPositions, dailyRealisedLoss (positive number = loss),
 *   livePrice { price, time } (fresh quote checked at decision time), filters { stepSize, minQty, minNotional },
 *   knownIdempotencyKeys (Set), rateLimitedUntil (ms)
 * }
 */
export function checkOrder(proposal, ctx) {
  const rules = [];
  const rule = (id, ok, detail) => { rules.push({ rule: id, ok: Boolean(ok), detail }); return ok; };
  const L = ctx.limits;

  // switches
  rule('emergency_stop', !ctx.controls.emergencyStop, 'platform emergency stop');
  rule('platform_pause', !ctx.controls.platformPaused, 'platform-wide pause');
  rule('customer_pause', !ctx.userPaused, 'customer paused trading');
  if (ctx.environment === 'live') {
    rule('live_enabled', ctx.controls.liveEnabled && ctx.exchangeLive, 'live trading and this exchange must both be approved');
  }
  rule('subscription', ctx.subscriptionActive, 'strategy subscription must be active');
  rule('strategy_version', ctx.strategyApproved, `strategy version approved for ${ctx.environment}`);
  rule('long_only', proposal.side === 'buy' || proposal.side === 'sell', 'spot long-only');
  rule('symbol', proposal.symbol === 'BTCUSDT' || proposal.symbol === 'ETHUSDT', 'BTC/USDT and ETH/USDT only');

  // duplicates and rate limits
  rule('duplicate', !ctx.knownIdempotencyKeys?.has(proposal.idempotencyKey), 'same idempotency key already used');
  rule('rate_limit', !(ctx.rateLimitedUntil > ctx.now), 'exchange asked us to slow down');

  // prices: never trade on stale data or when the market moved past the slippage limit
  const priceAge = ctx.now - Number(ctx.livePrice?.time ?? 0);
  rule('fresh_price', ctx.livePrice && priceAge >= 0 && priceAge <= L.maxPriceAgeMs, `price age ${priceAge} ms (max ${L.maxPriceAgeMs})`);
  const signalAge = ctx.now - Number(proposal.priceTime ?? 0);
  rule('fresh_signal', signalAge >= 0 && signalAge <= Math.max(L.maxPriceAgeMs, 60_000), `signal price age ${signalAge} ms`);
  let slipBps = null;
  if (ctx.livePrice && D(proposal.refPrice) > 0n) {
    const move = div(mul(sub(ctx.livePrice.price, proposal.refPrice), '10000'), proposal.refPrice);
    slipBps = Number(str(move, 2));
    // a buy is hurt by a higher price, a sell by a lower one
    const adverse = proposal.side === 'buy' ? slipBps : -slipBps;
    rule('slippage', adverse <= L.maxSlippageBps, `moved ${slipBps} bps since the signal (max ${L.maxSlippageBps})`);
  }

  // sizing
  let quantity = 0n, notional = 0n;
  const price = ctx.livePrice ? D(ctx.livePrice.price) : 0n;
  if (price > 0n) {
    if (proposal.side === 'buy') {
      notional = D(proposal.quoteAmount ?? '0');
      quantity = floorToStep(div(notional, price, 'down'), ctx.filters.stepSize);
    } else {
      quantity = floorToStep(D(proposal.quantity ?? '0') <= D(ctx.holding ?? '0') ? proposal.quantity : ctx.holding, ctx.filters.stepSize);
    }
    notional = mul(quantity, price);
  }
  rule('min_quantity', quantity >= D(ctx.filters.minQty), `quantity ${str(quantity)} (min ${ctx.filters.minQty})`);
  rule('min_notional', notional >= D(ctx.filters.minNotional), `value ${str(notional, 2)} USDT (min ${ctx.filters.minNotional})`);

  if (proposal.side === 'buy') {
    const fee = mul(notional, '0.001');
    rule('max_order', cmp(notional, L.maxOrderQuote) <= 0, `order ${str(notional, 2)} (max ${L.maxOrderQuote})`);
    rule('balance', cmp(add(notional, fee), ctx.availableQuote) <= 0, `needs ${str(add(notional, fee), 2)}, free ${ctx.availableQuote}`);
    rule('strategy_allocation', cmp(add(ctx.strategyExposure, notional), ctx.allocation) <= 0, `strategy would hold ${str(add(ctx.strategyExposure, notional), 2)} of ${ctx.allocation} allocated`);
    rule('max_position', cmp(add(ctx.strategyExposure, notional), L.maxPositionQuote) <= 0, `position ${str(add(ctx.strategyExposure, notional), 2)} (max ${L.maxPositionQuote})`);
    const exposurePct = D(ctx.equity) > 0n ? Number(str(div(mul(add(ctx.totalExposure, notional), '100'), ctx.equity), 2)) : Infinity;
    rule('max_exposure', exposurePct <= Number(L.maxExposurePct), `exposure ${exposurePct}% (max ${L.maxExposurePct}%)`);
    rule('max_positions', D(ctx.strategyExposure) > 0n || ctx.openPositions < L.maxConcurrentPositions, `${ctx.openPositions} open (max ${L.maxConcurrentPositions})`);
    rule('daily_loss', cmp(ctx.dailyRealisedLoss ?? '0', L.maxDailyLossQuote) < 0, `today's loss ${ctx.dailyRealisedLoss} (max ${L.maxDailyLossQuote}); only exits allowed`);
  } else {
    rule('holding', D(ctx.holding ?? '0') >= quantity && quantity > 0n, 'can only sell what this strategy holds (no short selling)');
  }

  const approved = rules.every((r) => r.ok);
  return { approved, rules, order: approved ? { quantity: str(quantity), notional: str(notional, 2), slippageBps: slipBps } : null };
}

/** Combined allocations may never exceed the capital the customer has on the exchange. */
export function checkAllocations(allocations, capital) {
  const total = allocations.reduce((s, a) => s + D(a.amount), 0n);
  return { ok: total <= D(capital) && allocations.every((a) => D(a.amount) >= 0n), total: str(total), capital: str(capital) };
}
