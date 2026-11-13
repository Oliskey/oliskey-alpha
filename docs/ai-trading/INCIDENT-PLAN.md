# Incident plan — Oliskey AI Trading

Draft 2026-11-13 for the owner to approve (roadmap 4.4). Keep it short enough to follow under stress.

## Who
| Role | Person | Contact |
|---|---|---|
| Decides and talks to customers | Owner (Oliskeylee Ltd) | [phone, email] |
| Fixes the system | Engineering | [contact] |
| Legal / regulator questions | Lawyer | [contact] |

## The two switches (Settings → AI Trading admin)
- **Pause all trading**: no new orders for anyone. Holdings stay on customers' exchange accounts. Use when unsure.
- **Emergency stop** (a reason is required): everything stops at once, and the app shows it to customers. Use when something is clearly wrong.
Both are recorded in the audit log. Neither moves money: Oliskey cannot withdraw from customer accounts.

## What to do
| What happened | First 15 minutes | Then |
|---|---|---|
| **Exchange down or very slow** (Binance) | Pause all trading. | Orders still open are reconciled automatically when it returns (every 2 minutes). Tell customers in-app. Resume when the exchange's status page is green. |
| **Orders refused or wrong** (many "Refused" or "Failed" in the admin overview) | Pause all trading. | Engineering reads trading.risk_events and system_events; fix; test on testnet; resume. |
| **A customer's key may be leaked** | That customer: disconnect in the app; ask them to delete the key on the exchange. | Keys cannot withdraw. Check that customer's orders for anything they did not expect. |
| **Our server or database was broken into, or a secret leaked** | Emergency stop. Rotate the leaked secret (database password, TRADING_CREDENTIALS_KEYS with a new key id, Paystack key). | Ask every customer to delete and recreate their exchange key. Inform the lawyer: data-protection and regulator notices may have deadlines (NDPA: 72 hours). |
| **A strategy behaves unexpectedly** (losses beyond its tested range) | Pause that strategy for everyone, or pause all trading. | Compare with its approved test record; it trades again only after a new version is approved with evidence. |
| **Payments wrong** (charged twice, not recorded) | Do nothing to the money in a hurry. | Payments are only marked paid after Paystack confirms; check the reference in Paystack and the ledger; refund through Paystack if needed. |
| **App or server down** | Check status: https://oliskey-alpha-production.up.railway.app/health | Railway restarts it automatically. Look at Railway logs. Customers' holdings are safe on their exchange either way. |

## After every incident
1. Write down what happened, when, who was affected, and what was done (keep in docs/ai-trading/incidents/).
2. Fix the cause, add a test that would have caught it, and only then resume.
3. Tell affected customers plainly what happened and what changed.

## Practice
Once a month, on testnet: switch Pause and Emergency stop on and off, and confirm the app shows it and no order is placed.
