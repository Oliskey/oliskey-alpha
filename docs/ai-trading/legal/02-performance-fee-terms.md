# 2. Fee terms (draft wording) with worked examples

> DRAFT for a Nigerian capital-markets lawyer. Not legal advice. The examples are calculated by the same code that will charge
> the fee (`backend/src/trading/money.js`, `commission()`), and are checked by its tests.

## Draft wording
**2.1 Subscription.** Each strategy costs US$2.50 per month. You may subscribe to 1 to 4 strategies in one payment. The amount
is charged in Naira at the rate shown at checkout. A subscription runs for one month from payment and may be cancelled at any
time; it then ends at the close of the paid month. No subscription can be bought for a strategy whose current version has not
been approved.

**2.2 Performance fee.** Oliskey charges **15% of new realised net profit** made by Oliskey's strategies on your exchange account
in real-money trading, above your **high-water mark**.
- *Realised net profit* is profit from completed sells, after the exchange's trading fees, calculated from the fills your exchange
  reports, using the average-cost method.
- *Unrealised profit* (assets you still hold, valued at today's price) is an estimate and is **never charged**.
- *High-water mark* is the highest cumulative realised net profit on which a fee has already been charged. You never pay twice
  on the same profit, and you pay nothing for winning back an earlier loss.
- The fee is calculated when you tell the app you are withdrawing from your exchange account, and is invoiced to you. It is
  never taken from your exchange account. Amounts are rounded down to the cent.
- Practice and testnet results are never charged.

**2.3 If you do not pay.** [To be decided with the lawyer: e.g. strategies pause for that customer until the invoice is paid.]

## Worked examples (all amounts in USDT)
| # | What happened | Cumulative realised net profit | High-water mark before | New profit above it | Fee (15%) | You keep | High-water mark after |
|---|---|---|---|---|---|---|---|
| 1 | First withdrawal after a good month | 200.00 | 0.00 | 200.00 | **30.00** | 170.00 | 200.00 |
| 2 | Next month loses 100 | 100.00 | 200.00 | 0.00 | **0.00** | — | 200.00 |
| 3 | Then earns 150 (back to 250) | 250.00 | 200.00 | 50.00 | **7.50** | 42.50 | 250.00 |
| 4 | Odd amount: profit 1,000.004 | 1,000.004 | 0.00 | 1,000.004 | **150.00** (rounded down from 150.0006) | 850.004 | 1,000.004 |

**Example 5 — holding, not sold.** You bought BTC for 1,000 and it is now worth 1,300. Nothing is sold, so realised profit is
0 and the fee is 0. The 300 appears on your statement as "Estimated profit", never charged.

**Example 6 — losses are yours.** Starting with 1,000, the strategy loses 120 after fees. No fee is charged and Oliskey does not
refund the loss. The high-water mark stays where it was, so the next 120 of profit is also free of fees.

## Questions for the lawyer
1. Is a 15% performance fee with a high-water mark permitted for this service, and under which licence?
2. Must the fee be capped, tiered, or disclosed in a prescribed form?
3. Is it lawful to invoice in USD terms and collect in NGN at a market rate read from public sources?
4. Is "declared withdrawal" an acceptable trigger, given customers can withdraw on the exchange without telling us?
5. What happens legally if a customer does not pay an invoice?
