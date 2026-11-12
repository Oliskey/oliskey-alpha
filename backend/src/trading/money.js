// Oliskey AI Trading money rules: subscription price, profit from fills, the 15% high-water-mark commission and the
// customer statement. Pure functions on exact decimals (./decimal.js); everything is reproducible from recorded fills.
import { D, add, sub, mul, div, cmp, max, sum, round, str } from './decimal.js';

export const PRICE_PER_STRATEGY_USD = '2.50';
export const MAX_STRATEGIES = 4;
export const COMMISSION_RATE = '0.15';

/** Monthly subscription for 1-4 strategies, one combined checkout: $2.50 each. */
export function subscriptionPrice(strategyIds) {
  const unique = [...new Set(strategyIds)];
  if (unique.length !== strategyIds.length) throw new RangeError('DUPLICATE_STRATEGY');
  if (unique.length < 1 || unique.length > MAX_STRATEGIES) throw new RangeError('CHOOSE_1_TO_4_STRATEGIES');
  return str(mul(PRICE_PER_STRATEGY_USD, unique.length), 2);
}

/**
 * Replays fills (oldest first) for one long-only position with the average-cost method.
 * A fill: { side: 'buy'|'sell', price, quantity, quoteQuantity, feeQuote, feeAsset, fee, baseAsset }.
 *  - A fee taken in the base asset (common on buys) reduces the coins received; its USDT value is a cost.
 *  - Any other fee (USDT, BNB...) is counted at its USDT value (feeQuote, recorded at fill time).
 * Realised profit on a sell = proceeds - share of cost basis - fees of that sell. Never sells more than is held.
 */
export function replayPosition(fills, baseAsset, { since } = {}) {
  let qty = 0n, cost = 0n, realised = 0n, fees = 0n, realisedSince = 0n;
  for (const f of fills) {
    const q = D(f.quantity), quote = D(f.quoteQuantity), feeQ = D(f.feeQuote);
    if (q <= 0n || quote <= 0n || feeQ < 0n) throw new RangeError('BAD_FILL');
    fees += feeQ;
    const feeInBase = f.feeAsset === baseAsset ? D(f.fee) : 0n;
    if (f.side === 'buy') {
      qty += q - feeInBase;
      cost += quote + (feeInBase ? 0n : feeQ);   // a base-asset fee is already "paid" by receiving fewer coins
    } else if (f.side === 'sell') {
      const sold = q + feeInBase;
      if (sold > qty) throw new RangeError('SELL_EXCEEDS_HOLDING');
      const costShare = qty === 0n ? 0n : div(mul(cost, sold, 'half_up'), qty);
      const proceeds = quote - (feeInBase ? 0n : feeQ);
      const r = proceeds - costShare - (feeInBase ? feeQ : 0n);
      realised += r;
      if (since !== undefined && Number(f.time) >= since) realisedSince += r;
      cost -= costShare; qty -= sold;
      if (qty === 0n) cost = 0n;
    } else throw new RangeError('BAD_SIDE');
  }
  return { quantity: qty, costBasis: cost, realised, fees, realisedSince };
}

/** Unrealised profit of a holding at a price (an estimate: it is never charged and never shown as realised). */
export const unrealised = (position, price) => sub(mul(position.quantity, price), position.costBasis);

/**
 * High-water-mark commission. `cumulativeRealised` is all realised net profit (after fees and losses) on live money
 * since the customer started; `hwm` is the part already charged. Only the rise above the mark is eligible, so a profit
 * is never charged twice and a loss must be recovered before anything new is charged. Commission is rounded DOWN to
 * the cent (never over-charge); the mark moves by the eligible amount actually invoiced.
 */
export function commission({ cumulativeRealised, hwm }) {
  const level = max(hwm, 0);
  const eligible = max(sub(cumulativeRealised, level), 0);
  if (eligible === 0n) return { eligible: '0', commission: '0.00', customerShare: '0', previousHwm: str(level), newHwm: str(level), due: false };
  const fee = round(mul(eligible, COMMISSION_RATE, 'down'), 2, 'down');
  if (fee === 0n) return { eligible: str(eligible), commission: '0.00', customerShare: str(eligible), previousHwm: str(level), newHwm: str(level), due: false };
  return {
    eligible: str(eligible), commission: str(fee, 2), customerShare: str(sub(eligible, fee)),
    previousHwm: str(level), newHwm: str(add(level, eligible)), due: true,
  };
}

/** The customer's statement. Estimates (unrealised) are labelled; only realised profit is ever charged. */
export function statement({ startingCapital, exchangeBalance, positions, prices, hwm, paidCommission = '0', openInvoices = [] }) {
  const realised = sum(positions.map((p) => p.realised));
  const fees = sum(positions.map((p) => p.fees));
  const unreal = sum(positions.filter((p) => p.quantity > 0n && prices[p.symbol]).map((p) => unrealised(p, prices[p.symbol])));
  const c = commission({ cumulativeRealised: realised, hwm });
  return {
    startingCapital: str(startingCapital), exchangeBalance: str(exchangeBalance),
    realisedNetProfit: str(realised), unrealisedProfitEstimate: str(unreal), tradingFees: str(fees),
    alreadyCharged: str(hwm), eligibleNow: c.eligible, commissionNow: c.commission, customerShareNow: c.customerShare,
    commissionPaid: str(paidCommission, 2),
    commissionOutstanding: str(sum(openInvoices.map((i) => i.commission)), 2),
    notes: ['Balances are reported by your exchange; Oliskey never holds your money.', 'Unrealised profit is an estimate and is never charged.'],
  };
}

export const _test = { cmp };
