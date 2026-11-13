# 1. Business model and money flow

> DRAFT for a Nigerian capital-markets lawyer. Not legal advice. Statements of law are questions to confirm.

## In one paragraph
Oliskey AI Trading is software. A customer opens an account with a crypto exchange (Binance first), creates an API key that
can only read the account and place spot orders, and gives that key to Oliskey. Oliskey's strategies then place buy and sell
orders for BTC/USDT and ETH/USDT on the customer's own exchange account. The money never leaves the customer's exchange
account and never passes through Oliskey. Oliskey charges a monthly subscription per strategy and a performance fee on new
realised profit.

## Parties
| Party | Role | Holds money? |
|---|---|---|
| Customer | Owns the exchange account and every asset in it; chooses strategies and how much each may use | Yes, on the exchange |
| Exchange (Binance) | Holds the customer's assets, executes orders, charges its own trading fees | Yes, in custody for the customer |
| Oliskeylee Ltd | Provides the strategies, the app and the order software; sends orders through the customer's key | **No** |
| Paystack | Collects Oliskey's subscription and fee payments in NGN | Only Oliskey's revenue, briefly |
| Banks | Settle Paystack payouts to Oliskey | — |

## Money flows
1. **Customer funds** — customer → their exchange account. Oliskey is not involved and cannot withdraw (the key cannot).
2. **Trading** — Oliskey's server sends orders through the customer's key; the exchange fills them and charges its fee to the
   customer. Profits and losses stay on the exchange account.
3. **Subscription** — customer → Paystack → Oliskey: $2.50 per strategy per month, converted to NGN at checkout using a rate
   read from two public sources that must agree within 2% (`backend/src/trading/fxRate.js`).
4. **Performance fee** — when the customer declares a withdrawal from the exchange, the server computes 15% of new realised
   net profit above the high-water mark (document 2) and issues an invoice; the customer pays it through Paystack in NGN.
   Oliskey never deducts it from the exchange account.
5. **Refunds / disputes** — handled through Paystack; process to be written (question 7.9).

## What Oliskey controls and does not control
- Controls: which orders are sent, their size within the limits the customer set, pauses, an emergency stop for everyone.
- Does not control: the customer's funds, withdrawals, the exchange's prices, fees, outages or solvency.
- Each order passes a deterministic risk check (fresh price, slippage, size, daily-loss and exposure limits, duplicates,
  long-only) and every decision is recorded.

## Activities the lawyer is asked to classify
| Activity | Our description | Question |
|---|---|---|
| Automated trading on a customer's account through their key | Discretionary-looking order placement by software, within limits the customer sets | Is this portfolio/fund management, investment advice, a robo-adviser, or a technology service under SEC Nigeria rules? |
| Strategy subscriptions | A fee for access to a strategy | Does charging for strategies make us an investment adviser? |
| 15% performance fee | Share of new realised profit | Is a performance fee permitted for this activity and customer type? Any caps or disclosure rules? |
| Showing strategy test results | Back-tests and live practice results with risk warnings | Rules on presenting past or simulated performance? |
| Crypto assets (BTC, ETH, USDT) | Spot only, on a foreign exchange | Treatment of digital assets as securities under the Investments and Securities Act 2025 and SEC digital-asset rules; do we need registration as a digital-asset operator or similar? |
| Collecting NGN through Paystack | Payment for a service | Any CBN rules on paying for crypto-related services in NGN? |
