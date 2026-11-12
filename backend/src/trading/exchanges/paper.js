// Paper exchange: simulated orders against REAL public prices (never invented ones). Market orders fill at the given
// price plus a fixed slippage, with a 0.1% fee taken in USDT, like a typical spot taker fee. Balances are virtual and
// clearly labelled paper in every record (environment = 'paper'). It implements the same contract as a real adapter, so
// the trading engine runs the same code path for paper and live.
import { randomUUID } from 'node:crypto';
import { D, add, sub, mul, div, cmp, floorToStep, str } from '../decimal.js';
import { ExchangeError, SYMBOLS } from './adapter.js';

const FEE = '0.001', SLIPPAGE = '0.0005';
const FILTERS = { BTCUSDT: { stepSize: '0.00001', minQty: '0.00001', tickSize: '0.01', minNotional: '5' }, ETHUSDT: { stepSize: '0.0001', minQty: '0.0001', tickSize: '0.01', minNotional: '5' } };

export class PaperAdapter {
  capabilities = new Set(['spot_market_order', 'cancel_order', 'order_status', 'fills', 'balances', 'client_order_id']);

  /** priceSource(symbol) → { price: "decimal string", time: ms } from a real feed; balances start at `startingUsdt`. */
  constructor({ providerId = 'paper', priceSource, now = () => Date.now(), startingUsdt = '10000' } = {}) {
    if (!priceSource) throw new Error('paper: a real price source is required');
    this.id = `paper:${providerId}`; this.priceSource = priceSource; this.now = now;
    this.wallet = new Map([['USDT', D(startingUsdt)], ['BTC', 0n], ['ETH', 0n]]);
    this.orders = new Map();
  }

  async verifyPermissions() { return { ok: true, canRead: true, canTradeSpot: true, forbidden: [], warnings: ['paper'] }; }
  async balances() { return [...this.wallet].map(([asset, v]) => ({ asset, free: str(v), locked: '0' })); }
  async symbols() { return Object.entries(SYMBOLS).map(([symbol, s]) => ({ symbol, ...s, status: 'trading', filters: FILTERS[symbol] })); }
  async price(symbol) { if (!SYMBOLS[symbol]) throw new ExchangeError('UNSUPPORTED', symbol); const p = await this.priceSource(symbol); return { symbol, ...p }; }
  async tradingFees() { return { maker: FEE, taker: FEE }; }

  async placeOrder({ symbol, side, type = 'market', quantity, quoteQuantity, clientOrderId }) {
    if (this.orders.has(clientOrderId)) return this.orders.get(clientOrderId);     // same id → same order, never a second
    if (type !== 'market') throw new ExchangeError('UNSUPPORTED', 'paper supports market orders');
    const { base } = SYMBOLS[symbol] || {}; if (!base) throw new ExchangeError('UNSUPPORTED', symbol);
    const { price: ref } = await this.priceSource(symbol);
    const px = side === 'buy' ? mul(ref, add('1', SLIPPAGE)) : mul(ref, sub('1', SLIPPAGE));
    const qty = floorToStep(quantity ? D(quantity) : div(quoteQuantity, px, 'down'), FILTERS[symbol].stepSize);
    if (qty <= 0n) throw new ExchangeError('ORDER_REJECTED', 'quantity too small');
    const quote = mul(qty, px), fee = mul(quote, FEE);
    if (side === 'buy') {
      if (cmp(add(quote, fee), this.wallet.get('USDT')) > 0) throw new ExchangeError('INSUFFICIENT_FUNDS', 'paper balance');
      this.wallet.set('USDT', this.wallet.get('USDT') - quote - fee); this.wallet.set(base, this.wallet.get(base) + qty);
    } else {
      if (qty > this.wallet.get(base)) throw new ExchangeError('INSUFFICIENT_FUNDS', 'paper holding');
      this.wallet.set(base, this.wallet.get(base) - qty); this.wallet.set('USDT', this.wallet.get('USDT') + quote - fee);
    }
    const o = {
      exchangeOrderId: randomUUID(), clientOrderId, symbol, side, type, status: 'filled', executedQty: str(qty), quoteQty: str(quote),
      fills: [{ id: randomUUID(), price: str(px), quantity: str(qty), quoteQuantity: str(quote), fee: str(fee), feeAsset: 'USDT', time: this.now() }],
    };
    this.orders.set(clientOrderId, o);
    return o;
  }
  async orderStatus(_symbol, clientOrderId) { return this.orders.get(clientOrderId) || null; }
  async cancelOrder(_symbol, clientOrderId) { const o = this.orders.get(clientOrderId); if (!o) throw new ExchangeError('NOT_FOUND', 'order'); return o; }
  async fills(_symbol, exchangeOrderId) { for (const o of this.orders.values()) if (o.exchangeOrderId === exchangeOrderId) return o.fills; return []; }
}
