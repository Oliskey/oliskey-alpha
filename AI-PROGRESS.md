# Oliskey Alpha: your questions and answers

The live numbers update by themselves in [AI-NUMBERS.md](AI-NUMBERS.md). This file records what you asked, the honest answer, and what is still open. Latest update: 7 November 2026, version 0.0.8.

## Your AI goal

Profit, not more trades. The AI trades only when the evidence says the trade should pay. Between trade lengths, longer only if really better.

## What you asked

| You asked | Answer | Status |
|---|---|---|
| 97 right out of 100 signals | Not achievable honestly. A test showing it would almost certainly be broken. The AI needs about 55.6% on Fixed Time and 47.6% on InZone to profit. The real score is in AI-NUMBERS.md. | **Not reached.** Working toward the highest real number |
| Make money overnight and always | Auto trade runs, but profit cannot be promised and losing nights are possible. The AI has not yet proven it makes money on real prices. | Running, not proven |
| Trading hours, days, when not to trade | Forex, indices and commodities get no signal while closed. Retested on the contest's winning version: no window of time is reliably bad enough to sit out on crypto. Public holidays are not known. | Built and retested |
| Shorter trades | 15-minute InZone earned more in total (+16,008 against +8,035 stakes) but less per trade (+0.119 against +0.136). Your rule needs both, so InZone stays at 60 minutes. | Decided by the rule |
| More profit, any better way | The all-coins contest found a better InZone version: see below. Stake by strength failed again on it. Fewer, stronger trades reached 64.3% wins at the highest bar tested, but less total profit (+2,574 against +8,032 stakes), so it failed too. | New version live on demo. Not proven live yet |
| Rust or Python | Python. You chose it, and it is what is running. | Done |
| Faster and lighter | Signals now appear about 10 to 17 seconds after the candle, down from about 44. AI InZone trades open a median of 7 seconds after the signal, and 90% within 20 seconds (all-time figures, including before the speed-up). | Done. To re-measure on the new model |
| Stop asking me to restart | The server now restarts itself. It still needs `npm run start:all` after the PC is shut down or the terminal is closed. | Done, tested |
| Commit always, with version numbers | Every step goes to GitHub as the next version. | Doing it. Tags are progress, not proof that everything passes |
| Keep answers in an MD file | This file and AI-NUMBERS.md. | Done |

## All-coins contest, 7 November

Tested on all 17 coins, on 3 separate 91-day periods the models never trained on, then on the newest 60 days kept out of every choice. Profit is in stakes: +1 means one stake earned. Full table: [docs/intel/WIDE.md](docs/intel/WIDE.md).

| Version | Won | Profit per trade | Total | Newest 60 days | Result |
|---|---:|---:|---:|---:|---|
| InZone today (5 coins, 3 years) | 52.02% | +0.092 | +6,268 | +491, won 48.88% | Replaced in the test |
| **InZone long view (17 coins, 4 years, adds days to months)** | 54.09% | +0.136 | +8,035 | +1,507, won 52.58% | **Winner** |
| Fixed Time, best total (17 coins, 4 years) | 56.79% | +0.022 | +99 | -53 | Fails. Gets no one's money |

- On the 5 usual coins alone, the winner earned about the same as today's model (+1,826 against +1,841). The gain comes from handling the other 12 coins better.
- InZone needs 47.6% to break even. Live, its record is still weak: 19 of 43 won (44.2%) in the 12 hours to 04:53 UTC on 7 November, from today's model.
- It then passed a last test on different minutes, with its rule fixed before any result ([docs/intel/WIDE_HARDER.md](docs/intel/WIDE_HARDER.md)):

| Coins | Won, entering 2 minutes late | Total | Newest 60 days, entering late | Result |
|---|---:|---:|---:|---|
| 5 usual | 55.57% | +1,743 | +355, won 52.93% | Passed |
| 12 others | 53.73% | +5,670 | +875, won 51.28% | Passed |

- **It went live on 7 November 2026 at 05:28 UTC, on demo money.** AI trades can now use all 17 coins. Every coin earned in this test, the weakest being UNI (+129) and NEAR (+232) entering late. The test reruns every week, and a group that stops passing stops getting money.
- **What to expect:** even at these numbers, the AI loses close to half its trades, and losing days and nights will happen. Live results are the real judge. It needs at least 100 finished trades on this model before anyone can say anything.

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
- Watch the new InZone model's live record and report it.
- Rerun the load test on a quiet PC: it was too slow under load, with 403 of 2,000 trades failing.
- Rerun the click-every-button test on a quiet PC. Its last run finished on 182 elements but was run under load. Direct checks cleared 3 suspect buttons, and tap sizes on 3 screens. The other 19 "no effect" flags still need checking, though most look like normal behaviour such as a tab already selected.
- Measure real entry times since the restart.

**Before real money can ever run**
- A licensed price feed, and written sign-off from a Nigerian capital-markets lawyer.
- A paid server and database backups.

## Honest warnings about the numbers

- **Test results are probably too high.** The best version was picked on the same periods that were reported. Trust the 60-day exam column more: it was kept out of the choice.
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
