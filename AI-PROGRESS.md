# Oliskey Alpha: your questions and answers

The live numbers update by themselves in [AI-NUMBERS.md](AI-NUMBERS.md). This file records what you asked, the honest answer, and what is still open. Latest update: 8 November 2026, version 0.0.27.

## Your AI goal

Profit, not more trades. The AI trades only when the evidence says the trade should pay. Between trade lengths, longer only if really better.

## What you asked

| You asked | Answer | Status |
|---|---|---|
| 97 right out of 100 signals | Not achievable honestly. A test showing it would almost certainly be broken. The AI needs about 55.6% on Fixed Time and 47.6% on InZone to profit. The real score is in AI-NUMBERS.md. | **Not reached.** Working toward the highest real number |
| Make money overnight and always | Auto trade runs, but profit cannot be promised and losing nights are possible. The AI has not yet proven it makes money on real prices. **It stops when your PC sleeps**, as it did for about 75 minutes on 7 November. Set Windows Settings, System, Power, sleep when plugged in, to Never, until the backend is hosted. | Running, not proven |
| Trading hours, days, when not to trade | Forex, indices and commodities get no signal while closed. Retested on the contest's winning version: no window of time is reliably bad enough to sit out on crypto. Public holidays are not known. | Built and retested |
| Shorter trades | 15-minute InZone earned more in total (+16,008 against +8,035 stakes) but less per trade (+0.119 against +0.136). Your rule needs both, so InZone stays at 60 minutes. | Decided by the rule |
| More profit, any better way | The all-coins contest found a better InZone version: see below. Stake by strength failed again on it. Fewer, stronger trades reached 64.3% wins at the highest bar tested, but less total profit (+2,574 against +8,032 stakes), so it failed too. | New version live on demo. Not proven live yet |
| Rust or Python | Python. You chose it, and it is what is running. | Done |
| Faster and lighter | Signals now appear about 10 to 17 seconds after the candle, down from about 44. AI InZone trades open a median of 7 seconds after the signal, and 90% within 20 seconds (all-time figures, including before the speed-up). | Done. To re-measure on the new model |
| Stop asking me to restart | The server now restarts itself. It still needs `npm run start:all` after the PC is shut down or the terminal is closed. | Done, tested |
| Commit always, with version numbers | Every step goes to GitHub as the next version. | Doing it. Tags are progress, not proof that everything passes |
| Navigation drop goes to its side | Done on phone: Home left, Market and Help right, Trades left when its list is long enough to scroll. Terminal does not scroll, so its pill stays whole. | Done. Terminal is your call |
| Trades hidden on the chart | Fixed: far-away trades no longer squash the candles, and they show at the edge of the chart with their entry price. | Done, tested |
| Keep answers in an MD file | This file and AI-NUMBERS.md. | Done |

## New inputs contest, 7 November: the model trading now

It adds what all 17 coins are doing together, how the corridor has been holding on each coin, and stronger training. Live on demo since 11:16 UTC. Full tables: [docs/intel/MARKET.md](docs/intel/MARKET.md) and [docs/intel/WIDE_HARDER.md](docs/intel/WIDE_HARDER.md).

| InZone version | Won | Per trade | Total | Worst day | Newest 60 days |
|---|---:|---:|---:|---:|---:|
| Previous | 54.21% | +0.138 | +7,928 | -59.7 | +1,521, won 52.40% |
| **Now live** | 54.89% | +0.153 | +8,939 | -45.5 | +1,690, won 54.04% |

Last test, on different minutes and entering 2 minutes late: the 5 usual coins won 55.89% and earned +394 on the newest 60 days; the other 12 won 54.25% and earned +1,045. Both passed. Those 60 days had already helped choose the earlier version, so they are no longer fully untouched. Live results are the real judge. The previous model finished 48 trades live, 24 won (50.0%), +α240.

## When in doubt, no trade (your rule, 7 November)

The AI trades a level of confidence only if trades at that level earned money on data it never trained on, even entering 2 minutes late. Test: `intel/run_strength_test.py`, weekly. It can only make the AI stricter. Users can choose Most profit (the default) or Strongest signals, once a level passes its test. **First result, 7 November, version 0.0.13, in force on demo:** the rule set the bar at a reading of 0.70, so the AI now takes about 18 trades a day instead of about 215. In the test, entering late, that won 70.78% and earned +2,434, against 54.55% and +8,548 for all trades, with a worst day of -15.6 against -66.0. Two thin levels (0.58 to 0.60 and 0.65 to 0.70) failed the money proof, though they won 59% and 67%, and that pushed the bar up. Most profit and Strongest signals are now the same, so the choice is hidden. Your decision is open: see `docs/intel/STRENGTH.md`.

**Third contest, 7 November:** nothing beat the model trading now ([docs/intel/RISK.md](docs/intel/RISK.md)). Forecasting market moves earned +7,624 and a limit of 8 open trades +5,966, against +8,951.

## The AI learns from every trade, automatically

| When | What it does |
|---|---|
| Every finished InZone trade | Records why it won or lost, measured from real prices |
| Every day | Retrains on the newest prices. A restart or a sleeping PC delays this, never cancels it |
| Every week | Studies its wins and losses. A warning sign seen before entry joins the strategy only if it passes a fixed test showing those trades lose money. One that stops passing leaves |

Results: [docs/intel/CAUSES.md](docs/intel/CAUSES.md). It trades only in "winning conditions" if that test shows more total profit, because a higher win rate on fewer trades has earned less before.

**First study, 7 November, from 71,734 test trades:** the biggest cause of losses is the whole market moving after entry (52.5% of test losses, 50.6% of live), then a steady move in one direction (30.4% and 38.0%). Of 12 warning signs seen before entry, none passed: even the worst still won 52.86%, above the 47.62% needed, so no rule was added. Trading only the best condition won 59.02% but earned +2,803, against 55.00% and +9,070 for all trades, so the AI keeps trading them all. Using those conditions to raise the stake is your decision, and it would need its own test first.

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

## Hosting

| Item | Status |
|---|---|
| GitHub | Connected and private |
| Railway | Backend and AI engine, one copy in Europe: https://oliskey-alpha-production.up.railway.app . Retraining is off there for now |
| Supabase | Database and accounts. 15 migrations applied |
| Vercel | Builds the real app, talking to Railway |
| Google sign-in | Button built, stays hidden until you set it up |
| Cloudflare domain | Later |

## Still open

**You**
- Change your Supabase database password when the backend is connected.
- Google sign-in: create the Google credentials and put them in Supabase. The button comes with the move to Supabase Auth. Decide whether the official Google logo may be used on it.
- Choose a backend server. Oracle does not accept your location.
- Set PC sleep to Never when plugged in, until the backend is hosted.
- Check [GitHub billing](https://github.com/settings/billing): GitHub's automatic tests do not start, and the cause looks like the account, not the code.
- Your own Forex trades held α9,499 when last checked. They are yours to keep or close.

**Me**
- Watch the new InZone model's live record and report it.
- One button-test oddity is unexplained: it reports 84 buttons with tap areas under 44 px, but direct measures on Home, Market, Terminal and Settings show none, and I could not reproduce it. The worst it could mean is a tap margin a few pixels short.
- Measure real entry times since the restart.

**Before real money can ever run**
- A licensed price feed, and written sign-off from a Nigerian capital-markets lawyer.
- A paid server and database backups.

## Honest warnings about the numbers

- **Test results are probably too high.** The best version was picked on the same periods that were reported. Trust the 60-day exam column more: it was kept out of the choice.
- **InZone's profit may not be real skill.** It wins against the corridor and payout your own app sets, so in real trading that profit would be your company's loss.
- **Fixed Time would not survive real exchange costs.** Its predicted move is about 0.05%, against about 0.25% in costs.
- **Demo money is not real money.** These results include no real orders.

## App checks, 7 November, on a quiet PC

- **Load test: passed.** 1,000 viewers, 2,000 trades in 20 seconds: all accepted and all settled, median 68 ms, 0 money mismatches. Last time, 403 failed. This is one PC, not a hosted server.
- **Buttons: no broken button found.** 183 pressed, 20 flagged "no effect". Pressed directly, Add to favorites (saved after reload), Increase, Show trade options, WhatsApp, Email, Accept task and Open a trade all work. Tabs already selected and the Saved button change nothing, as expected. A few flags on the Market and Trades tabs were not separately pressed.

## Corrections

- **7 November:** I said your own trades lost α29,168. That was wrong: my query counted test accounts. Your account's own trades were +α6,580 at that time, from 62 trades, which is too few to draw a conclusion.
- **7 November:** I said there were 363 test accounts. The cleanup script counts 358. You deleted them the same day: 0 left, and your 7 other accounts were kept.

## Commands

| To do this | Run |
|---|---|
| Start everything | `npm run start:all` |
| Delete the test accounts, permanently | `node scripts/clean-test-accounts.mjs --yes` |
