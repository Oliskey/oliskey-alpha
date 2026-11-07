# Oliskey Alpha: your questions and answers

The live numbers update by themselves in [AI-NUMBERS.md](AI-NUMBERS.md). This file records what you asked, the honest answer, and what is still open. Latest update: 7 November 2026, version 0.0.6.

## Your AI goal

Profit, not more trades. The AI trades only when the evidence says the trade should pay. Between trade lengths, longer only if really better.

## What you asked

| You asked | Answer | Status |
|---|---|---|
| 97 right out of 100 signals | Not achievable honestly. A test showing it would almost certainly be broken. The AI needs about 55.6% on Fixed Time and 47.6% on InZone to profit. The real score is in AI-NUMBERS.md. | **Not reached.** Working toward the highest real number |
| Make money overnight and always | Auto trade runs, but profit cannot be promised and losing nights are possible. The AI has not yet proven it makes money on real prices. | Running, not proven |
| Trading hours, days, when not to trade | Forex, indices and commodities get no signal while closed. 80 windows of time tested on crypto: none reliably bad enough to avoid. Public holidays are not known. | Built. Being retested on 17 coins |
| Shorter trades | Fixed Time lost at 5 and 15 minutes in earlier tests. 15-minute InZone is in the contest. | Testing |
| More profit, any better way | Stake by strength earned more in a test on the older model (+2,509 against +2,004 stakes) but failed because the worst day was too deep. Fewer, stronger trades reached 65.2% wins but less total profit. | Both being retested on the new model |
| Rust or Python | Python. You chose it, and it is what is running. | Done |
| Faster and lighter | Signals now appear about 10 to 17 seconds after the candle, down from about 44. A scan took 4.6 seconds, down from about 10. | Done. Trade entry times still to be measured |
| Stop asking me to restart | The server now restarts itself. It still needs `npm run start:all` after the PC is shut down or the terminal is closed. | Done, tested |
| Commit always, with version numbers | Every step goes to GitHub as the next version. | Doing it. Tags are progress, not proof that everything passes |
| Keep answers in an MD file | This file and AI-NUMBERS.md. | Done |

## Hosting, paused at your request

| Item | Status |
|---|---|
| GitHub | Connected and private |
| Vercel | Connected, screens only. People cannot sign up or trade there yet |
| Supabase | Database ready, with 14 migrations applied. The app is not switched to it yet |
| Backend server | Oracle free server was chosen, and your account was in progress. Supabase cannot run the backend or the AI engine |
| Sign-in | Moving to Supabase Auth. Needs your publishable key in `app/.env` |
| Cloudflare domain | Later |

## Still open

**You**
- Change your Supabase database password when the backend is connected.
- Check [GitHub billing](https://github.com/settings/billing): GitHub's automatic tests do not start, and the cause looks like the account, not the code.
- Your own Forex trades held α9,499 when last checked. They are yours to keep or close.

**Me**
- Finish the 4-year download, the all-coins contest, and the tests after it.
- Rerun the load test on a quiet PC: it was too slow under load, with 403 of 2,000 trades failing.
- Rerun the click-every-button test on a quiet PC. Its last run finished on 182 elements but was run under load. Direct checks cleared 3 suspect buttons, and tap sizes on 3 screens. The other 19 "no effect" flags still need checking, though most look like normal behaviour such as a tab already selected.
- Measure real entry times since the restart.

**Before real money can ever run**
- A licensed price feed, and written sign-off from a Nigerian capital-markets lawyer.
- A paid server and database backups.

## Honest warnings about the numbers

- **Test results are probably too high.** The best version was picked on the same periods that were reported. The new contest adds a 60-day exam to fix this.
- **InZone's profit may not be real skill.** It wins against the corridor and payout your own app sets, so in real trading that profit would be your company's loss.
- **Fixed Time would not survive real exchange costs.** Its predicted move is about 0.05%, against about 0.25% in costs.
- **Demo money is not real money.** These results include no real orders.

## Corrections

- **7 November:** I said your own trades lost α29,168. That was wrong: my query counted test accounts. Your account's own trades were +α6,580 at that time, from 62 trades, which is too few to draw a conclusion.
- **7 November:** I said there were 363 test accounts. The cleanup script counts 358. You deleted them the same day: 0 left, and your 7 other accounts were kept.

## Commands

| To do this | Run |
|---|---|
| Start everything | `npm run start:all` |
| Delete the test accounts, permanently | `node scripts/clean-test-accounts.mjs --yes` |
