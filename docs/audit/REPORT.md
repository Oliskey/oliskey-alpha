# Oliskey Alpha — production-readiness audit (Prompt 11)

30 Oct 2026, run locally (Windows, Docker Postgres 17, Node 26, web build). Live trading stays **off**.
Details: [inventory.md](inventory.md) (every element, KEEP/FIX/REMOVE), [buttons.md](buttons.md) (press-every-button run).

## Verdict

The **demo app is in good shape**: money rules hold under every test, attack and crash we tried.
It is **not ready for real money or a public launch yet**: the items under "Still open" and "Only you can do" must be closed first,
and the 200 trades/second target has not been shown on production-grade hosting.

## What passed (with proof)

| Area | Proof |
|---|---|
| Money rules (payouts, refunds, InZone, forex stop-out, idempotent settle, deposits once, promo once, withdrawals, demo reset, ledger = balance) | `npm run db:test` → supabase/tests/001_money_rules.sql PASS |
| Close Early (new): server-priced, 90% cap, 2 s / 3 s window, only once, races with expiry, other users, other modes | 002_close_early.sql PASS + backend/test/close-early.test.mjs (3 tests) + browser run |
| RLS: users see only their own rows, cannot write balances or call money functions | 001_money_rules.sql (RLS block) PASS |
| Two trades at once never overspend; 5 simultaneous Close Early requests pay once | trading.test.mjs, close-early.test.mjs |
| Every protected route refuses anonymous (31 routes) and non-admin callers; forged / alg=none / swapped tokens refused | backend/test/api-security.test.mjs |
| Hostile input (SQL in fields and filters, broken JSON, 120 KB body, prototype keys, wrong types) → clean 4xx, no money moved | api-security.test.mjs |
| Admin 2-step login (new): RFC 6238 vectors, codes work once, ticket is not a session, admin tools locked without it | backend/test/admin-mfa.test.mjs |
| Server stopped with trades open; they expired while it was down; on restart every one settled at its expiry time, ledger matched | manual restart test (3 trades closed at exact expiry, balance 9,785 = expected); DB check: 0 stuck trades, 0 ledger mismatches across all users |
| Load: 1,000 live price viewers stayed connected; ledger exact after 4,000 trades | scripts/load-test.mjs (0 ledger mismatches, all 4,000 accepted) |
| Engine self-tests (Wilson bound, isotonic calibration, no look-ahead) | intel/selftest.py PASS |
| All suites | backend 26/26, db 3/3 files, engine all, app typecheck — run 30 Oct after the last change |

## What failed or is weak

| # | Problem | Status |
|---|---|---|
| 1 | Anyone registering an email in `ADMIN_EMAILS` became admin (emails are not verified) → admin takeover on a fresh deploy | **Fixed**: removed; admins only via `npm run db:admin -- <email>` |
| 2 | `trust proxy` was always on → any client could fake its IP and bypass rate limits | **Fixed**: `TRUST_PROXY=1` only behind Render/Railway |
| 3 | Login answered faster for unknown emails → account probing by timing | **Fixed**: same scrypt work either way |
| 4 | Broken JSON body returned 500 | **Fixed**: 400 / 413 |
| 5 | Admins had no 2-step login | **Fixed**: authenticator codes required for every admin tool |
| 6 | **Throughput**: 200 trades/s not reached locally. With 10 DB connections: 42/s, p50 77 s; with 40: 133/s, p50 4 s, settlement lag up to 10 s. Cause: each DB round trip costs ~21 ms on Docker Desktop for Windows (normal: <1 ms) | **Open**: pool size now configurable (`DB_POOL_MAX`, default 20). Re-run `scripts/load-test.mjs` on the hosted DB before launch |
| 7 | 59 tap targets under 44 px (tabs 43 px high, chart icons 32 px, "Show All" 19 px) | **Open** (accessibility pass) |
| 8 | After a new web deploy, open browsers fail to load screens ("Loading module … failed") because old code files are gone | **Open**: keep the previous build's files for a day, or reload the page on that error |
| 9 | Dead buttons: WhatsApp (no number), Terms / Privacy (not links), "+ Add Account" (toast only) | WhatsApp **fixed** (0904 941 7103). Terms / Privacy / Add Account still **open** |
| 10 | Unreachable code: Home "scanner" sheet | **Removed** (no feature lost) |
| 11 | Momentum bar % could be read as "traders buying" | **Fixed**: "% up ticks / % down ticks" |
| 12 | FAQ said all prices are simulated (crypto is live) | **Fixed** |
| 13 | npm audit: 3 high in Expo's build tools (zod via @expo/cli), not in the server | Accepted for now; npm's only "fix" is downgrading Expo to 51 |

## KEEP / FIX / REMOVE (summary — full list in inventory.md)

- **KEEP**: all trading, chart, history, AI analysis, scanner, lessons, deposit/withdraw (switched off), admin.
- **FIX**: bonus story circle opens Deposit (rename or add a bonus page); Forgot password (needs hosted Supabase email);
  18+ check at sign-up; risk line at sign-up and first trade; delete-account; small tap targets; WhatsApp/Terms/Privacy.
- **REMOVED (your decision 30 Oct)**: Terminal "scanner mode".
- **Backlog**: Flip Direction, Extend Duration ([docs/backlog.md](../backlog.md)).

## Still open (I can do these next)

1. 18+ confirmation at sign-up. (Delete account is **done**: Profile → Delete account; only after real money is withdrawn and no trade is open; name/phone/email removed, trades and ledger kept — migration 007, tests 003_close_account.sql + account-delete.test.mjs.)
2. Accessibility pass: 44 px targets, labels on 4 unlabeled inputs, screen-reader check.
3. Deploy safety: keep old web files after a deploy; Sentry error alerts (needs a Sentry account/DSN); uptime alert on `/health`.
4. Backups: hosted Supabase does daily backups on paid plans; locally add a `pg_dump` schedule if you want one.
5. Playwright / Maestro suites: the headless-browser button check (`scripts/e2e-buttons.mjs`) covers web; Android/iOS need an emulator and Maestro installed.
6. Re-run the load test on production-like hosting.

## Only you can do

- Licence and written lawyer sign-off for each mode (Fixed Time, InZone, Forex) — required before live trading (CLAUDE.md gate).
- A licensed price/liquidity feed for live accounts.
- Paystack business approval and live keys.
- Hosted Supabase project (free org is at its 2-project limit) and Render/Railway account.
- Apple Developer and Google Play accounts; privacy policy URL for the stores.
- Terms of Service, Privacy Policy and risk wording (lawyer); support WhatsApp number and email.
- Turn on 2-step login for your admin account: Profile → Set up 2-step login (admin tools stay locked until you do).
- Sentry and uptime-monitor accounts if you want alerts.
- Push this folder to GitHub so `.github/workflows/ci.yml` runs the tests on every change (the folder is not a git repo yet).
