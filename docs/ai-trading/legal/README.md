# Oliskey AI Trading — pack for a Nigerian capital-markets lawyer

> **DRAFTS. NOT LEGAL ADVICE.** Written by the product team (with AI help) on 2026-11-12 to brief a qualified Nigerian
> capital-markets lawyer. Nothing here has been reviewed by a lawyer or a regulator. Every statement about Nigerian law is a
> question to confirm, not a conclusion. Real-money trading stays OFF until written sign-off (REAL-MONEY GATE, `CLAUDE.md`).

**Company:** Oliskeylee Ltd (Nigeria) · **Product:** Oliskey Alpha (web, Android, iOS) · **Feature:** Oliskey AI Trading

## Contents
| # | Document | What the lawyer is asked to do |
|---|---|---|
| 1 | [Business model and money flow](01-business-model-and-money-flow.md) | Confirm which activities are regulated and how |
| 2 | [15% fee terms with worked examples](02-performance-fee-terms.md) | Review the fee wording and its fairness |
| 3 | [Trading risk disclosure](03-risk-disclosure.md) | Make it compliant and sufficient |
| 4 | [Terms of service (AI Trading)](04-terms-of-service.md) | Turn into enforceable terms |
| 5 | [Privacy notice](05-privacy-notice.md) | Check against the Nigeria Data Protection Act 2023 and NDPC rules |
| 6 | [KYC / AML assessment](06-kyc-aml-assessment.md) | Confirm obligations and gaps |
| 7 | [Questions for SEC Nigeria and the Binance broker programme](07-questions-sec-and-binance.md) | Answer, or tell us whom to ask |

## Facts the lawyer can rely on (from the code, 2026-11-12)
- Customers connect **their own** exchange account (Binance first) with an API key that may **read and trade spot only**.
  Keys that allow withdrawals or transfers are refused by the server (`backend/src/trading/service.js`).
- Oliskey **never holds customer money or crypto**. Balances stay on the exchange, in the customer's name.
- Pairs: BTC/USDT and ETH/USDT, spot, **long-only** (no borrowing, margin, futures or short selling).
- Revenue: **$2.50 per strategy per month** (1–4 strategies) and **15% of new realised net profit** above a high-water mark,
  invoiced when the customer declares a withdrawal and paid separately through Paystack in NGN.
- Today only practice (paper) and Binance **testnet** (test money) are possible. No subscription or fee can be paid.
- The approval centre requires evidence (link + note + approver) for: exchange agreement, legal sign-off, API integration,
  security review, penetration test, payment provider, production setup and final activation. The database refuses live
  trading for an exchange until all are approved (`supabase/migrations/020_ai_trading.sql`).
