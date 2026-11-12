# Oliskey AI Trading — exchange-connected, non-custodial

Added beside the existing Alpha modes (owner decision 2026-11-12). Customers trade spot BTC/USDT and ETH/USDT on their
own exchange accounts through API keys that can trade but never withdraw. Oliskey never holds customer money.
Revenue: $2.50 per strategy per month (one checkout, 1–4 strategies) plus 15% of eligible realised net profit above a
high-water mark, invoiced when the customer declares a withdrawal and paid separately through Paystack.

## What exists (phase 1)
| Area | Where | Tested |
|---|---|---|
| Database: 28 tables in schema `trading`, RLS, append-only records, balanced ledger, approval guards | `supabase/migrations/020_ai_trading.sql` | `supabase/tests/008_ai_trading.sql` |
| Rollback | `supabase/rollback/020_ai_trading_down.sql` | — |
| Exact decimal money (no floats) | `backend/src/trading/decimal.js` | `trading-money.test.mjs` |
| Pricing, profit from fills (average cost), 15% HWM commission, statement | `backend/src/trading/money.js` | `trading-money.test.mjs` |
| Encrypted credentials (AES-256-GCM, owner-bound, rotation) | `backend/src/trading/vault.js` | `trading-exchange.test.mjs` |
| Exchange contract + capability registry | `backend/src/trading/exchanges/` | `trading-exchange.test.mjs` |
| Binance adapter (signing, permission check, precision, idempotent orders, rate limits) | `exchanges/binance.js` | recorded answers only (Binance is not reachable from the build machine) |
| Paper exchange (real prices only) | `exchanges/paper.js` | `trading-exchange.test.mjs` |
| Deterministic risk engine (pauses, stop, stale price, slippage, limits, duplicates, long-only) | `backend/src/trading/risk.js` | `trading-exchange.test.mjs` |
| Order flow: risk → order row → exchange → fills → position | `backend/src/trading/service.js` | `trading-api.test.mjs` |
| Payments: subscription and commission checkout, Paystack verification, ledger | `backend/src/trading/payments.js` | `trading-api.test.mjs` |
| API: `/trading/*` (customers), `/admin/trading/*` (admins with 2-step login) | `backend/src/routes/aiTrading.js` | `trading-api.test.mjs` |

## Server settings (secrets; never committed)
- `TRADING_CREDENTIALS_KEYS` = `k1:<base64 of 32 random bytes>` and `TRADING_CREDENTIALS_ACTIVE` = `k1` (`openssl rand -base64 32`)
- `TRADING_USD_NGN_RATE` — NGN per USD for checkout (set by the operator; never guessed)
- `PAYSTACK_SECRET_KEY` (already used by Alpha)

## Live trading stays off until
The database refuses `live_enabled` for an exchange until its commercial, API-integration and security approvals AND the
platform's legal, penetration-test, payment-provider, production and final activation approvals are all approved with
evidence (link + note + approver). The global live switch needs at least one approved exchange. This matches the
REAL-MONEY GATE in CLAUDE.md.

## Not done yet (next phases)
1. App screens (marketplace, connection wizard, strategies, checkout, allocation, positions, statements, invoices,
   admin approval centre). The API is ready for them.
2. Strategy engine → signals: connect the four strategies to `trading_signals` with versioned, approved configs
   (the existing AI Spot agents and lab gates are the starting point). No strategy version is approved yet.
3. Reconciliation job (balances and fills on a schedule), subscription renewal/expiry job.
4. OKX, Bybit, KuCoin, Gate.io adapters (phases 2–5).
5. Legal/regulatory pack (terms, risk disclosure, performance-fee agreement, privacy, KYC/AML assessment) for a lawyer.
6. Independent penetration test.
