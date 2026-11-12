// Exchange registry. An exchange is usable only when its adapter exists here; whether it may trade LIVE money is decided
// by trading.exchange_providers.live_enabled, which the database allows only after every approval (020_ai_trading.sql).
import { BinanceAdapter } from './binance.js';
import { PaperAdapter } from './paper.js';
import { ExchangeError } from './adapter.js';

const ADAPTERS = { binance: BinanceAdapter };

/** Phase plan shown to customers and admins. Only 'binance' has an adapter in phase 1. */
export const PHASES = [
  { id: 'binance', phase: 1 }, { id: 'okx', phase: 2 }, { id: 'bybit', phase: 3 }, { id: 'kucoin', phase: 4 }, { id: 'gateio', phase: 5 },
];

export const hasAdapter = (id) => Boolean(ADAPTERS[id]);

/** environment: 'paper' (simulated, uses public prices), 'testnet' or 'live'. */
export function adapterFor(providerId, { environment, credentials, fetchImpl, priceSource, now } = {}) {
  if (environment === 'paper') return new PaperAdapter({ providerId, priceSource, now });
  const A = ADAPTERS[providerId];
  if (!A) throw new ExchangeError('UNSUPPORTED', `${providerId} is not available yet`);
  return new A({ environment, credentials, fetchImpl, now });
}
