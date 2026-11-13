# 6. KYC / AML assessment (draft)

> DRAFT for a Nigerian capital-markets lawyer / compliance officer. Not legal advice. Our own reading of the risks, for the lawyer
> to confirm or correct, including which Nigerian AML/CFT obligations (e.g. under the Money Laundering (Prevention and Prohibition)
> Act 2022 and SEC AML/CFT regulations) apply to Oliskey.

## Why our exposure may be lower than a custodial platform
- Oliskey never receives, holds or sends customer crypto or money. Deposits and withdrawals happen only on the exchange.
- The exchange (Binance) performs its own KYC on every account holder before they can trade.
- Our only money in is subscriptions and fees, paid through Paystack, which does its own checks.

## Where risk remains
| Risk | Example | Current control | Gap |
|---|---|---|---|
| Account takeover | Someone connects a stolen exchange key | Keys that can withdraw are refused; per-user limit on connection attempts; audit log | No check that the exchange account belongs to the Oliskey user |
| Using our service to move value | Wash trading between accounts | Long-only spot BTC/ETH; risk limits; no transfers possible through the key | No cross-customer surveillance yet |
| Sanctioned persons | A sanctioned person subscribes | Exchange KYC; Paystack checks | No sanctions screening by Oliskey |
| Fee payments from third parties | Someone pays another person's invoice | Paystack verification of amount and reference | No payer-identity match |
| Minors | Under-age user | Terms require age 18+ | No age check |
| Identity (existing Alpha withdrawals) | — | BVN + bank account + name match through Paystack before withdrawals | — |

## Proposed controls before real-money trading (for the lawyer to confirm which are required)
1. Identity verification before connecting a live key: reuse the Paystack BVN/bank check already built for Alpha withdrawals.
2. Ask the exchange (via the broker programme) to confirm the account's KYC level or name, if the API allows.
3. Sanctions screening at sign-up and periodically.
4. Thresholds and reporting: who files suspicious-activity reports, to whom (NFIU?), and when.
5. Record keeping: how long to keep orders, fills, invoices and identity results.
6. A named compliance officer and a written AML/CFT policy.
