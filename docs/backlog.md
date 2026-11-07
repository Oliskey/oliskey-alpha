# Backlog

Features decided "not now" by the owner. Each one moves money, so each needs its own Postgres function
(called only by the backend with the service key), tests, and owner sign-off before it is built.

## Flip Direction (Fixed Time) — not now (owner decision 2026-10-30)

Turn an open Up trade into Down (or the reverse) without closing it.

- Open questions for the owner: the fee (fixed % of the stake, or priced like Close Early from the current chance
  of winning?), whether the opening quote resets to the current price, and how many flips a trade may have.
- Must follow the Close Early rules: server prices it, not in the first 2 s or last 3 s, row lock so it can never
  race with expiry or a close.

## Extend Duration (Fixed Time) — not now (owner decision 2026-10-30)

Push an open trade's expiry further out.

- Open questions: the fee, the allowed extensions (e.g. +30 s / +1 min / +5 min), the maximum total duration
  (open_trade allows 4 h), and whether the payout % changes for the longer trade.
- Same server-side pricing, timing window and row-lock rules as Close Early.

## Done

- Close Early (Fixed Time) — built 2026-10-30: `close_trade_early` in supabase/migrations/005_close_early.sql,
  GET/POST /trades/:id/close-early, tests in supabase/tests/002_close_early.sql and backend/test/close-early.test.mjs.
