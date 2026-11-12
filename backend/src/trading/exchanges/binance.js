// Binance spot adapter (phase 1). Live: https://api.binance.com · Testnet: https://testnet.binance.vision
// Reference: https://developers.binance.com/docs/binance-spot-api-docs
//  - Signed requests: HMAC-SHA256 of the query string with the API secret; key in X-MBX-APIKEY; recvWindow 5 s.
//  - Every order carries newClientOrderId. If the answer to a new order is lost (timeout, network), the adapter asks for
//    the order by that id instead of sending it again, so a retry can never create a second order.
//  - 429 / 418 answers are rate limits: the adapter stops and reports Retry-After; it never hammers the exchange.
//  - The key must NOT allow withdrawals, internal or universal transfers, margin loans or futures (checked against
//    /sapi/v1/account/apiRestrictions on live; the testnet has no such endpoint and testnet keys hold no real money).
import { createHmac } from 'node:crypto';
import { ExchangeError, SYMBOLS } from './adapter.js';

const BASES = { live: 'https://api.binance.com', testnet: 'https://testnet.binance.vision' };
const STATUS = { NEW: 'new', PARTIALLY_FILLED: 'partially_filled', FILLED: 'filled', CANCELED: 'cancelled', PENDING_CANCEL: 'new', REJECTED: 'rejected', EXPIRED: 'expired', EXPIRED_IN_MATCH: 'expired' };
const INTERVALS = new Set(['1m', '5m', '15m', '1h', '4h', '1d']);
const isNet = (e) => e?.name === 'AbortError' || e?.name === 'TimeoutError' || e instanceof TypeError;

export class BinanceAdapter {
  id = 'binance';
  capabilities = new Set(['spot_market_order', 'spot_limit_order', 'cancel_order', 'order_status', 'fills', 'balances', 'klines',
    'order_book', 'trading_fees', 'key_permissions_check', 'client_order_id', 'testnet']);

  /** credentials: { apiKey, apiSecret } (may be omitted for public data). fetchImpl and now are injectable for tests. */
  constructor({ environment = 'testnet', credentials, fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 10_000 } = {}) {
    if (!BASES[environment]) throw new Error('binance: environment must be live or testnet');
    this.environment = environment; this.base = BASES[environment];
    this.creds = credentials; this.fetch = fetchImpl; this.now = now; this.timeoutMs = timeoutMs; this.clockOffset = 0;
  }

  async request(method, path, params = {}, { signed = false } = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) q.set(k, String(v));
    const headers = {};
    if (signed) {
      if (!this.creds?.apiKey || !this.creds?.apiSecret) throw new ExchangeError('INVALID_KEY', 'missing credentials');
      q.set('recvWindow', '5000'); q.set('timestamp', String(Math.round(this.now() + this.clockOffset)));
      q.set('signature', createHmac('sha256', this.creds.apiSecret).update(q.toString()).digest('hex'));
      headers['X-MBX-APIKEY'] = this.creds.apiKey;
    }
    let res;
    try {
      res = await this.fetch(`${this.base}${path}?${q}`, { method, headers, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      throw new ExchangeError('NETWORK', isNet(e) ? 'network error or timeout' : String(e?.message || e));
    }
    const text = await res.text();
    let body; try { body = text ? JSON.parse(text) : {}; } catch { body = null; }
    if (res.status === 429 || res.status === 418) {
      const ra = Number(res.headers?.get?.('retry-after')) || 60;
      throw new ExchangeError('RATE_LIMITED', `rate limited (${res.status})`, { retryAfterMs: ra * 1000, httpStatus: res.status });
    }
    if (res.status >= 500) throw new ExchangeError('EXCHANGE_DOWN', `exchange error ${res.status}`, { httpStatus: res.status });
    if (!body) throw new ExchangeError('BAD_RESPONSE', 'not JSON', { httpStatus: res.status });
    if (res.status >= 400) throw this.mapError(body, res.status);
    return body;
  }

  mapError(body, httpStatus) {
    const code = body?.code, msg = String(body?.msg || '');
    const e = (c) => new ExchangeError(c, msg || c, { exchangeCode: code, httpStatus });
    if (code === -2015 || code === -2014 || code === -1022 || code === -2008) return e('INVALID_KEY');
    if (code === -1021) return e('CLOCK_SKEW');
    if (code === -2013 || code === -2011 && /Unknown order/i.test(msg)) return e('NOT_FOUND');
    if (code === -2010 && /insufficient balance/i.test(msg)) return e('INSUFFICIENT_FUNDS');
    if (code === -2010 || code === -1013 || code === -1111 || code === -1100 || code === -1102) return e('ORDER_REJECTED');
    if (code === -1003 || code === -1015) return e('RATE_LIMITED');
    return e('ORDER_REJECTED');
  }

  async syncClock() {
    const t0 = this.now(); const { serverTime } = await this.request('GET', '/api/v3/time');
    this.clockOffset = serverTime - (t0 + this.now()) / 2;
  }

  // ── Key checks ──
  async verifyPermissions() {
    const acct = await this.request('GET', '/api/v3/account', { omitZeroBalances: true }, { signed: true });
    const forbidden = [], warnings = [];
    let canRead = true, canTradeSpot = acct.canTrade === true && (acct.permissions || ['SPOT']).includes('SPOT');
    if (this.environment === 'live') {
      const r = await this.request('GET', '/sapi/v1/account/apiRestrictions', {}, { signed: true });
      canRead = r.enableReading === true;
      canTradeSpot = canTradeSpot && r.enableSpotAndMarginTrading === true;
      if (r.enableWithdrawals) forbidden.push('withdrawals');
      if (r.enableInternalTransfer) forbidden.push('internal_transfer');
      if (r.permitsUniversalTransfer) forbidden.push('universal_transfer');
      if (r.enableMargin) forbidden.push('margin_loans');
      if (r.enableFutures) forbidden.push('futures');
      if (r.enableVanillaOptions) forbidden.push('options');
      if (!r.ipRestrict) warnings.push('ip_not_restricted');
    }
    return { ok: canRead && canTradeSpot && forbidden.length === 0, canRead, canTradeSpot, forbidden, warnings };
  }

  // ── Account and market ──
  async balances() {
    const acct = await this.request('GET', '/api/v3/account', { omitZeroBalances: true }, { signed: true });
    return (acct.balances || []).map((b) => ({ asset: b.asset, free: b.free, locked: b.locked }));
  }

  async symbols() {
    const info = await this.request('GET', '/api/v3/exchangeInfo', { symbols: JSON.stringify(Object.keys(SYMBOLS)) });
    return (info.symbols || []).map((s) => {
      const f = Object.fromEntries((s.filters || []).map((x) => [x.filterType, x]));
      return {
        symbol: s.symbol, base: s.baseAsset, quote: s.quoteAsset, status: s.status === 'TRADING' ? 'trading' : 'halted',
        filters: {
          stepSize: f.LOT_SIZE?.stepSize, minQty: f.LOT_SIZE?.minQty, marketStepSize: f.MARKET_LOT_SIZE?.stepSize || f.LOT_SIZE?.stepSize,
          tickSize: f.PRICE_FILTER?.tickSize, minNotional: f.NOTIONAL?.minNotional ?? f.MIN_NOTIONAL?.minNotional,
        },
      };
    });
  }

  async price(symbol) {
    check(symbol);
    const r = await this.request('GET', '/api/v3/ticker/price', { symbol });
    return { symbol, price: r.price, time: this.now() };
  }

  async candles(symbol, interval = '1h', limit = 200) {
    check(symbol); if (!INTERVALS.has(interval)) throw new ExchangeError('UNSUPPORTED', 'interval');
    const rows = await this.request('GET', '/api/v3/klines', { symbol, interval, limit: Math.min(1000, limit) });
    const now = this.now();
    return rows.map((k) => ({ openTime: k[0], open: k[1], high: k[2], low: k[3], close: k[4], volume: k[5], closeTime: k[6], closed: k[6] < now }));
  }

  async orderBook(symbol, limit = 20) {
    check(symbol);
    const r = await this.request('GET', '/api/v3/depth', { symbol, limit });
    return { bids: r.bids, asks: r.asks, time: this.now() };
  }

  async tradingFees(symbol) {
    check(symbol);
    const r = await this.request('GET', '/api/v3/account/commission', { symbol }, { signed: true });
    return { maker: r.standardCommission?.maker, taker: r.standardCommission?.taker };
  }

  // ── Orders ──
  normalise(o) {
    return {
      exchangeOrderId: String(o.orderId), clientOrderId: o.clientOrderId, symbol: o.symbol, side: String(o.side).toLowerCase(),
      type: String(o.type).toLowerCase(), status: STATUS[o.status] || 'new', executedQty: o.executedQty, quoteQty: o.cummulativeQuoteQty,
      fills: o.fills?.map((f) => ({ id: String(f.tradeId), price: f.price, quantity: f.qty, quoteQuantity: undefined, fee: f.commission, feeAsset: f.commissionAsset })),
    };
  }

  async placeOrder({ symbol, side, type = 'market', quantity, quoteQuantity, price, clientOrderId }) {
    check(symbol);
    if (!/^[A-Za-z0-9_-]{1,36}$/.test(clientOrderId || '')) throw new ExchangeError('ORDER_REJECTED', 'clientOrderId required');
    if (side !== 'buy' && side !== 'sell') throw new ExchangeError('ORDER_REJECTED', 'side');
    const p = { symbol, side: side.toUpperCase(), newClientOrderId: clientOrderId, newOrderRespType: 'FULL' };
    if (type === 'market') { p.type = 'MARKET'; if (quoteQuantity) p.quoteOrderQty = quoteQuantity; else p.quantity = quantity; }
    else if (type === 'limit') { p.type = 'LIMIT'; p.timeInForce = 'GTC'; p.quantity = quantity; p.price = price; }
    else throw new ExchangeError('UNSUPPORTED', 'order type');
    try {
      return this.normalise(await this.request('POST', '/api/v3/order', p, { signed: true }));
    } catch (e) {
      // The order may have reached the exchange even though the answer did not reach us: look it up, never resend.
      if (e.code === 'NETWORK' || e.code === 'EXCHANGE_DOWN') {
        try {
          const found = await this.orderStatus(symbol, clientOrderId);
          if (found) return found;
          return { clientOrderId, symbol, side, type, status: 'rejected', executedQty: '0', quoteQty: '0', note: 'not received by exchange' };
        } catch {
          throw new ExchangeError('UNKNOWN_ORDER_STATE', 'order state unknown; will reconcile by clientOrderId');
        }
      }
      throw e;
    }
  }

  async orderStatus(symbol, clientOrderId) {
    check(symbol);
    try { return this.normalise(await this.request('GET', '/api/v3/order', { symbol, origClientOrderId: clientOrderId }, { signed: true })); }
    catch (e) { if (e.code === 'NOT_FOUND') return null; throw e; }
  }

  async cancelOrder(symbol, clientOrderId) {
    check(symbol);
    return this.normalise(await this.request('DELETE', '/api/v3/order', { symbol, origClientOrderId: clientOrderId }, { signed: true }));
  }

  async fills(symbol, exchangeOrderId) {
    check(symbol);
    const rows = await this.request('GET', '/api/v3/myTrades', { symbol, orderId: exchangeOrderId }, { signed: true });
    return rows.map((t) => ({ id: String(t.id), price: t.price, quantity: t.qty, quoteQuantity: t.quoteQty, fee: t.commission, feeAsset: t.commissionAsset, time: t.time, isBuyer: t.isBuyer }));
  }
}

function check(symbol) { if (!SYMBOLS[symbol]) throw new ExchangeError('UNSUPPORTED', `symbol ${symbol} is not offered`); }
