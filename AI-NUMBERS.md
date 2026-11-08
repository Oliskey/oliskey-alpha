# Oliskey Alpha: the AI's real numbers

Updated by the engine 2026-11-08 05:38 UTC. Demo money on real crypto prices. Test accounts are not counted. It can lose.

## Score

**Last 100 of 100 signals: 62 right, 38 wrong (62.0%), +α2,139.81.**

Clean record: 251 trades across 29 separate hours. It needs at least 100 to judge, and even a profit can be luck.

## New InZone model, since it went live on 2026-11-07 11:16 UTC

| Who | Trade type | Finished | Won | Won % | Profit |
|---|---|---:|---:|---:|---:|
| AI, on real accounts | inzone | 2 | 1 | 50.0% | +α10.00 |

It needs at least 100 finished trades before anyone can say it works. Its tests: docs/intel/WIDE_HARDER.md.

## Last 12 hours, auto trades on real accounts

| Who | Trade type | Finished | Won | Won % | Profit |
|---|---|---:|---:|---:|---:|
| AI, on real accounts | forex | 2 | 1 | 50.0% | -α0.62 |

## All time, real accounts

| Who | Trade type | Finished | Won | Won % | Profit |
|---|---|---:|---:|---:|---:|
| AI, on real accounts | fixed_time | 6 | 4 | 66.7% | +α42.89 |
| AI, on real accounts | inzone | 114 | 60 | 52.6% | +α1,162.94 |
| AI, on real accounts | forex | 8 | 7 | 87.5% | +α302.75 |
| People, by hand | fixed_time | 53 | 25 | 47.2% | +α6,590.76 |
| People, by hand | inzone | 2 | 0 | 0.0% | -α20.00 |
| People, by hand | forex | 7 | 7 | 100.0% | +α9.21 |

## Open now, real accounts

- None

## Tests

- All-coins contest, 2026-11-07T04:59: winners {'fixed_time': 'today (5 coins, 3 years)', 'inzone': 'long view (17, 4 years, days to months)', 'inzone_15': 'all coins (17, 4 years)'}. InZone length: 60 minutes.
- When to trade, 2026-11-07T04:59: 80 windows tested. To sit out: none proved.
- Fewer, stronger trades: inzone: none passed; fixed_time: none passed.
- Why trades fail, 2026-11-07T12:16: 12 warning signs tested. Added to its strategy: none passed. Details: docs/intel/CAUSES.md.
- If it is not sure, it does not trade, 2026-11-07T16:26: it trades InZone only at a reading of 0.7 or higher. Strongest signals level: 0.7. Details: docs/intel/STRENGTH.md.
- Stake by strength: inzone: failed; fixed_time: passed.

Questions, answers and what is still open: see AI-PROGRESS.md.
