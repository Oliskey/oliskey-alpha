// The common contract every exchange adapter implements, and the errors they raise. The AI and the trading engine only
// ever talk to this contract, so adding an exchange never changes them. All amounts are decimal strings.
//
//  adapter.id, adapter.capabilities (Set of capability names, mirrored in trading.exchange_capabilities)
//  verifyPermissions()          → { ok, canRead, canTradeSpot, forbidden: [...], warnings: [...] }
//  balances()                   → [{ asset, free, locked }]
//  symbols()                    → [{ symbol, base, quote, status, filters: { stepSize, minQty, tickSize, minNotional } }]
//  price(symbol)                → { symbol, price, time }
//  candles(symbol, interval, limit) → [{ openTime, open, high, low, close, volume, closed }]
//  orderBook(symbol, limit)     → { bids: [[price, qty]], asks: [[price, qty]], time }
//  placeOrder({ symbol, side, type, quantity?, quoteQuantity?, price?, clientOrderId }) → normalised order
//  cancelOrder(symbol, clientOrderId) → normalised order
//  orderStatus(symbol, clientOrderId) → normalised order | null (not found)
//  fills(symbol, exchangeOrderId) → [{ id, price, quantity, quoteQuantity, fee, feeAsset, time, isBuyer }]
//  tradingFees(symbol)          → { maker, taker }   (fractions, e.g. "0.001")
//
// Normalised order: { exchangeOrderId, clientOrderId, symbol, side, type, status, executedQty, quoteQty, fills? }
// status ∈ new | partially_filled | filled | cancelled | rejected | expired

export const CAPABILITIES = ['spot_market_order', 'spot_limit_order', 'cancel_order', 'order_status', 'fills', 'balances',
  'klines', 'order_book', 'trading_fees', 'key_permissions_check', 'client_order_id', 'testnet'];

export class ExchangeError extends Error {
  /** code: INVALID_KEY | FORBIDDEN_PERMISSION | RATE_LIMITED | INSUFFICIENT_FUNDS | ORDER_REJECTED | NOT_FOUND |
   *        CLOCK_SKEW | EXCHANGE_DOWN | NETWORK | UNKNOWN_ORDER_STATE | UNSUPPORTED | BAD_RESPONSE */
  constructor(code, message, { retryAfterMs, exchangeCode, httpStatus } = {}) {
    super(message); this.code = code; this.retryAfterMs = retryAfterMs; this.exchangeCode = exchangeCode; this.httpStatus = httpStatus;
  }
}

/** Customer-facing words for each error (never the exchange's raw text, which can carry account details). */
export const EXCHANGE_MESSAGES = {
  INVALID_KEY: 'The exchange did not accept this API key. Check the key and secret, or create a new key.',
  FORBIDDEN_PERMISSION: 'This key allows withdrawals or transfers. Create a key with only reading and spot trading switched on.',
  MISSING_PERMISSION: 'This key cannot read the account or place spot orders. Switch on reading and spot trading for it.',
  RATE_LIMITED: 'The exchange is busy. Trying again shortly.',
  INSUFFICIENT_FUNDS: 'Not enough balance on your exchange account for this order.',
  ORDER_REJECTED: 'The exchange rejected the order.',
  NOT_FOUND: 'Not found on the exchange.',
  CLOCK_SKEW: 'Time check with the exchange failed. Trying again.',
  EXCHANGE_DOWN: 'The exchange is not responding right now.',
  NETWORK: 'Could not reach the exchange.',
  UNKNOWN_ORDER_STATE: 'The order state is being confirmed with the exchange.',
  UNSUPPORTED: 'This exchange does not support that action yet.',
  BAD_RESPONSE: 'The exchange sent an unexpected answer.',
};

export const SYMBOLS = Object.freeze({ BTCUSDT: { base: 'BTC', quote: 'USDT' }, ETHUSDT: { base: 'ETH', quote: 'USDT' } });
