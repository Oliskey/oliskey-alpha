# 5. Privacy notice — Oliskey Alpha and AI Trading (draft)

> DRAFT for a Nigerian capital-markets lawyer / data-protection adviser. Not legal advice. To be checked against the Nigeria Data
> Protection Act 2023 and NDPC regulations, including whether Oliskey must register with the NDPC or appoint a DPO.

**Controller:** Oliskeylee Ltd, [address], [contact email for privacy].

## What we collect and why
| Data | Why | Kept |
|---|---|---|
| Name, email, password (stored as a one-way hash by our sign-in provider) | Your account and sign-in | While the account is open |
| Google account email (if you sign in with Google) | Sign-in | While the account is open |
| Phone number (if you give it) | Account contact | While the account is open |
| Exchange API key and secret | To trade on your exchange account | Encrypted (AES-256-GCM); deleted when you disconnect |
| Exchange balances, orders, fills | Your results, statements and fees | [Retention period — likely years for financial records] |
| Strategy choices, limits, pauses | Run the service as you asked | While the account is open |
| Payments (reference, amount, status) | Subscriptions and fees, accounting | [Statutory period] |
| Identity checks: BVN and bank account (Alpha withdrawals) | Fraud and AML checks | **BVN is sent to Paystack and never stored by us**; the result is kept |
| App settings (theme, chart, favourites) | Your settings on every device | While the account is open |
| Device push tokens | Alerts you switched on | Until you switch alerts off |
| IP address and security events | Security, fraud prevention, audit | [Period] |

We do not sell your data. We do not use it for advertising.

## Who processes it for us
| Processor | What for | Where |
|---|---|---|
| Supabase | Database and sign-in | [Region of the hosted project] |
| Railway | Application server | Netherlands (europe-west4) |
| Vercel | Website delivery | Global edge network |
| Paystack | Payments and identity checks | Nigeria |
| Binance | Your exchange account (you choose to connect it) | [Binance entity and location] |
| Google | Sign-in with Google (if you use it) | Global |
| Email provider [e.g. Resend] | Sign-in and password emails | [Location] |

[International transfer safeguards to be stated as the NDPA requires.]

## Your rights
You can ask to see, correct, export or delete your data, object to processing, or withdraw consent, by [contact]. Deleting your
account removes your personal details; some financial records may have to be kept by law. You can complain to the Nigeria Data
Protection Commission.

## Security
Passwords are never stored in readable form. Exchange keys are encrypted and bound to your account. Database tables holding
trading data cannot be read by the app's public roles. We keep an audit log of security events. No system is perfectly secure;
an independent penetration test is planned before real-money trading.
