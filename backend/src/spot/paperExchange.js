// Paper exchange adapter for AI Spot (docs/spot/SPEC.md Part M). Same interface a live adapter will have:
//   getFilters, getBalances, placeOrder, getOrder, cancel, onPrice
// Fills at the live price it is fed, charges the real taker fee, adds slippage, enforces exchange filters,
// and is idempotent on clientOrderId: sending the same order twice returns the first order, never a second fill.
// Real money is impossible here by construction: this adapter has no network and no keys.

import { DEFAULT_FILTERS, roundQty } from './risk.js';

export class PaperExchange {
  constructor({ quote = 10_000, fee = 0.001, slippage = 0.0002, filters = DEFAULT_FILTERS, partialFillRatio = 1 } = {}) {
    this.balances = { USDT: quote, BTC: 0, ETH: 0 };
    this.fee = fee;
    this.slippage = slippage;
    this.filters = filters;
    this.partialFillRatio = partialFillRatio;   // < 1 simulates a partial fill on the first attempt
    this.orders = new Map();
    this.prices = {};
    this.seq = 0;
  }

  getFilters(symbol) { return this.filters[symbol]; }
  getBalances() { return { ...this.balances }; }
  getOrder(clientOrderId) { return this.orders.get(clientOrderId) ?? null; }

  placeOrder({ clientOrderId, symbol, side, type = 'MARKET', qty, stopPrice }) {
    if (!clientOrderId) throw new Error('clientOrderId is required');
    const existing = this.orders.get(clientOrderId);
    if (existing) return existing;                                  // idempotent retry
    const f = this.filters[symbol];
    const base = symbol.split('/')[0];
    const order = { clientOrderId, venueOrderId: `paper-${++this.seq}`, symbol, side, type, qty, stopPrice,
      filledQty: 0, avgPrice: 0, fee: 0, status: 'NEW', fills: [], createdAt: new Date().toISOString() };
    const reject = (why) => { order.status = 'REJECTED'; order.reason = why; this.orders.set(clientOrderId, order); return order; };
    if (!f) return reject('unknown symbol');
    if (roundQty(qty, f.stepSize) !== qty || qty < f.minQty) return reject('quantity breaks the step size or minimum');
    if (side === 'SELL' && qty > this.balances[base] + 1e-12) return reject('cannot sell more than held (spot: no shorts)');
    this.orders.set(clientOrderId, order);
    if (type === 'STOP_MARKET') { order.status = 'OPEN'; return order; }
    const px = this.prices[symbol];
    if (!(px > 0)) return reject('no price yet');
    this.#fill(order, side === 'BUY' ? px * (1 + this.slippage) : px * (1 - this.slippage), qty * this.partialFillRatio);
    return order;
  }

  cancel(clientOrderId) {
    const o = this.orders.get(clientOrderId);
    if (o && ['NEW', 'OPEN', 'PARTIALLY_FILLED'].includes(o.status)) o.status = o.filledQty > 0 ? 'PARTIALLY_FILLED_CANCELED' : 'CANCELED';
    return o;
  }

  /** Feed a price; resting stop orders trigger at it (filled at the price, minus slippage: never at a better level). */
  onPrice(symbol, price) {
    this.prices[symbol] = price;
    const hit = [];
    for (const o of this.orders.values()) {
      if (o.symbol === symbol && o.type === 'STOP_MARKET' && o.status === 'OPEN' && price <= o.stopPrice) {
        const base = symbol.split('/')[0];
        this.#fill(o, Math.min(price, o.stopPrice) * (1 - this.slippage), Math.min(o.qty, this.balances[base]));
        hit.push(o);
      }
    }
    return hit;
  }

  #fill(order, price, qtyWanted) {
    const f = this.filters[order.symbol];
    const base = order.symbol.split('/')[0];
    let qty = roundQty(qtyWanted, f.stepSize);
    if (order.side === 'BUY') {
      const affordable = roundQty(this.balances.USDT / (price * (1 + this.fee)), f.stepSize);
      qty = Math.min(qty, affordable);
      if (qty < f.minQty || qty * price < f.minNotional) { order.status = 'REJECTED'; order.reason = 'insufficient balance'; return; }
      const fee = qty * price * this.fee;
      this.balances.USDT -= qty * price + fee;
      this.balances[base] += qty;
      order.fee += fee;
    } else {
      qty = Math.min(qty, roundQty(this.balances[base], f.stepSize));
      const fee = qty * price * this.fee;
      this.balances[base] -= qty;
      this.balances.USDT += qty * price - fee;
      order.fee += fee;
    }
    order.avgPrice = (order.avgPrice * order.filledQty + price * qty) / (order.filledQty + qty);
    order.filledQty = Number((order.filledQty + qty).toFixed(10));
    order.fills.push({ qty, price, at: new Date().toISOString() });
    order.status = order.filledQty + 1e-12 >= order.qty ? 'FILLED' : 'PARTIALLY_FILLED';
  }
}
