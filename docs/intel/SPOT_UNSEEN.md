# AI Spot batch 3: frozen candidates on unseen coins

Generated 2026-11-10 06:43 UTC. Pre-registered in `docs/intel/SPOT_HYPOTHESES.md` (batch 3) before this run. Coins never used for any AI Spot strategy before: ADA, AVAX, BNB, DOGE, DOT, LINK, SOL, XRP. Settings frozen; costs 0.12% per side, re-run at 1.5x and 2x; 4h signals, 1d context.

## trend_breakout 0.1.0 — **APPROVED_FOR_PAPER**

305 trades · win 39.3% · expectancy +0.519R (lower bound +0.194R) · profit factor 2.42 · at 1.5x costs +0.505R · at 2x +0.491R · bootstrap 95th-pct drawdown 16.4%

- PASS: expectancy lower bound > 0 (1x costs)
- PASS: expectancy > 0 at 1.5x costs
- PASS: >= 70% of folds profitable
- PASS: sealed test (last 20%) expectancy > 0
- PASS: bootstrap 95th pct drawdown <= 25%
- PASS: at least 62% of coins profitable

| Coin | Trades | Expectancy R |
| --- | ---: | ---: |
| ADA | 41 | +0.580 |
| AVAX | 22 | +0.206 |
| BNB | 70 | +0.440 |
| DOGE | 27 | +1.615 |
| DOT | 19 | -0.106 |
| LINK | 51 | +0.293 |
| SOL | 40 | +0.371 |
| XRP | 35 | +0.796 |

| Window | Trades | Expectancy R |
| --- | ---: | ---: |
| 2018-06-02 to 2019-10-27 | 17 | +0.161 |
| 2019-10-27 to 2021-03-22 | 71 | +0.927 |
| 2021-03-22 to 2022-08-16 | 68 | +0.588 |
| 2022-08-16 to 2024-01-10 | 28 | +1.093 |
| 2024-01-10 to 2025-06-04 | 84 | +0.085 |
| 2025-06-04 to 2026-10-29 | 37 | +0.327 |

## squeeze_breakout 0.1.0 — **REJECTED**

245 trades · win 34.7% · expectancy +0.189R (lower bound -0.011R) · profit factor 1.48 · at 1.5x costs +0.163R · at 2x +0.148R · bootstrap 95th-pct drawdown 21.7%

- FAIL: expectancy lower bound > 0 (1x costs)
- PASS: expectancy > 0 at 1.5x costs
- PASS: >= 70% of folds profitable
- PASS: sealed test (last 20%) expectancy > 0
- PASS: bootstrap 95th pct drawdown <= 25%
- PASS: at least 62% of coins profitable

| Coin | Trades | Expectancy R |
| --- | ---: | ---: |
| ADA | 33 | +0.243 |
| AVAX | 17 | +0.076 |
| BNB | 56 | +0.355 |
| DOGE | 15 | +0.090 |
| DOT | 15 | +0.028 |
| LINK | 47 | +0.154 |
| SOL | 31 | +0.224 |
| XRP | 31 | +0.040 |

| Window | Trades | Expectancy R |
| --- | ---: | ---: |
| 2018-06-05 to 2019-10-30 | 16 | +0.382 |
| 2019-10-30 to 2021-03-24 | 49 | +0.374 |
| 2021-03-24 to 2022-08-17 | 61 | +0.134 |
| 2022-08-17 to 2024-01-11 | 23 | -0.020 |
| 2024-01-11 to 2025-06-05 | 64 | +0.023 |
| 2025-06-05 to 2026-10-29 | 32 | +0.396 |

