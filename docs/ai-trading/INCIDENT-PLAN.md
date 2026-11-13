# Incident plan --- Oliskey AI Trading

**Status: Approved by the Owner of Oliskeylee Ltd**\
**Approval date: 2026-11-13**\
**Document purpose:** Operational response guide for incidents affecting
Oliskey AI Trading. Keep it short enough to follow under stress.\
**Roadmap reference:** Phase 4.4.

## Who

  -----------------------------------------------------------------------
  Role                    Person                  Contact
  ----------------------- ----------------------- -----------------------
  Decides and talks to    Owner (Oliskeylee Ltd)  09049417103 ·
  customers                                       oliskeylee@gmail.com

  Fixes the system        Engineering             oliskeylee@gmail.com ·
                                                  09049417103

  Legal / regulator       Miss Oliver             08038110985
  questions                                       
  -----------------------------------------------------------------------

## The two switches (Settings → AI Trading admin)

-   **Pause all trading:** No new orders for anyone. Holdings stay in
    customers' exchange accounts. Use when unsure.
-   **Emergency stop** (a reason is required): Stops trading immediately
    and displays the emergency state to customers. Use when something is
    clearly wrong.

Both actions must be recorded in the audit log. Neither moves money:
Oliskey cannot withdraw from customers' exchange accounts.

## What to do

  -------------------------------------------------------------------------------------------------------------
  What happened           First 15 minutes                                         Then
  ----------------------- -------------------------------------------------------- ----------------------------
  **Exchange down or very Pause all trading.                                       Open orders are reconciled
  slow (Binance)**                                                                 when the exchange returns
                                                                                   (the system is configured to
                                                                                   check every 2 minutes). Tell
                                                                                   customers in-app. Resume
                                                                                   only after checking the
                                                                                   exchange status and
                                                                                   confirming normal operation.

  **Orders refused or     Pause all trading.                                       Engineering reviews
  wrong** (many "Refused"                                                          `trading.risk_events` and
  or "Failed" statuses in                                                          `system_events`, identifies
  the admin overview)                                                              and fixes the cause, tests
                                                                                   on testnet, and obtains
                                                                                   approval before resuming.

  **A customer's exchange Disconnect that customer's exchange connection in the    Confirm the key has no
  key may be leaked**     app. Tell the customer to revoke/delete the key directly withdrawal or transfer
                          on the exchange.                                         permission. Review the
                                                                                   customer's orders for
                                                                                   unexpected activity and
                                                                                   document the incident.

  **Our server or         Activate Emergency stop. Restrict access and preserve    Rotate the compromised
  database was            relevant logs.                                           secret (for example,
  compromised, or a                                                                database password,
  secret leaked**                                                                  `TRADING_CREDENTIALS_KEYS`
                                                                                   using a new key ID, or
                                                                                   Paystack key). Assess
                                                                                   whether customer exchange
                                                                                   keys must also be revoked
                                                                                   and recreated. Notify the
                                                                                   lawyer promptly so
                                                                                   applicable data-protection
                                                                                   and regulatory notification
                                                                                   duties and deadlines can be
                                                                                   assessed.

  **A strategy behaves    Pause the affected strategy for everyone, or pause all   Compare behaviour with the
  unexpectedly** (for     trading if the scope is uncertain.                       approved strategy test
  example, losses or                                                               record. Do not resume until
  behaviour outside its                                                            the cause is understood and
  tested range)                                                                    a new or corrected strategy
                                                                                   version has been tested and
                                                                                   approved with evidence.

  **Payments are wrong**  Do not make hurried manual ledger changes or issue an    Mark payments as paid only
  (duplicate charge or    unverified refund.                                       after Paystack confirmation.
  payment not recorded)                                                            Check the Paystack reference
                                                                                   against the internal ledger.
                                                                                   Process any required refund
                                                                                   through Paystack and record
                                                                                   the outcome.

  **App or server is      Check the health endpoint:                               Review Railway service
  down**                  https://oliskey-alpha-production.up.railway.app/health   status and logs. Confirm
                                                                                   whether automatic restart
                                                                                   has restored service. Keep
                                                                                   customers informed. Customer
                                                                                   holdings remain in their own
                                                                                   exchange accounts.
  -------------------------------------------------------------------------------------------------------------

## After every incident

1.  Record what happened, when it happened, who was affected, the
    actions taken and the outcome. Store the record in
    `docs/ai-trading/incidents/`.
2.  Identify and fix the root cause. Add or update a test that would
    detect the failure. Do not resume affected trading until the
    required checks and approvals are complete.
3.  Communicate clearly with affected customers: explain what happened,
    what was affected and what has changed.
4.  Record the incident review, corrective actions, owner and completion
    date.

## Practice

Once a month, use testnet to exercise **Pause all trading** and
**Emergency stop**. Confirm that the customer-facing app displays the
correct state, the actions appear in the audit log, and no new order is
placed while trading is paused or stopped. Record the test date,
participants, results and any follow-up actions.

## Approval record

-   **Approved by:** Owner, Oliskeylee Ltd
-   **Approval date:** 2026-11-13
-   **Status:** Approved
-   **Scope:** This approval confirms the incident-response plan as an
    internal operational procedure. It does not replace legal advice,
    regulatory authorisation, security testing or approval of the
    real-money trading launch.
