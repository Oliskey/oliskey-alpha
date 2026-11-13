# Market Intelligence Engine: walk-forward results

Generated 2026-11-12 22:38 UTC from 25 market/timeframe series, 88,889 simulated trades (86,784 out-of-sample).

**How to read this.** Every trade risks 1R (stop 1.5 ATR) and aims for 1R, 1.5R or 2R (the "(1.5:1)" and "(2:1)" versions). *Break-even* is the hit rate needed to cover costs: (1 + cost) / (1 + R). A strategy is **accepted** only if, out-of-sample, it has at least 200 trades, the 95% lower bound of its hit rate is above break-even, and the 95% lower bound of its average result (expectancy, in R) is above zero - with targets above 1:1 many "wins" are small time exits, so the hit rate alone is not enough. Out-of-sample = every calendar year after the first; each year's probabilities and models come only from earlier years. Same-bar stop+target counts as a loss.

## 1. Rule strategies (out-of-sample)

| Market | Strategy | Trades | Hit rate | 95% low | Break-even | Expectancy (R) | Profit factor | Max drawdown (R) | Verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| Crypto (1 h bars) | Breakout | 8284 | 50.2% | 49.1% | 56.3% | -0.117 | 0.79 | 997.3 | Rejected |
| Crypto (1 h bars) | Breakout (1.5:1) | 7932 | 41.7% | 40.6% | 45.0% | -0.093 | 0.85 | 777.6 | Rejected |
| Crypto (1 h bars) | Breakout (2:1) | 7733 | 36.7% | 35.6% | 37.5% | -0.084 | 0.88 | 689.0 | Rejected |
| Crypto (1 h bars) | Mean reversion | 3757 | 47.3% | 45.7% | 56.1% | -0.172 | 0.71 | 670.0 | Rejected |
| Crypto (1 h bars) | Mean reversion (1.5:1) | 3711 | 38.5% | 37.0% | 44.9% | -0.177 | 0.74 | 700.3 | Rejected |
| Crypto (1 h bars) | Mean reversion (2:1) | 3697 | 35.2% | 33.7% | 37.4% | -0.144 | 0.80 | 572.1 | Rejected |
| Crypto (1 h bars) | Trend pullback | 10078 | 48.8% | 47.8% | 55.6% | -0.128 | 0.77 | 1330.4 | Rejected |
| Crypto (1 h bars) | Trend pullback (1.5:1) | 9295 | 40.3% | 39.3% | 44.5% | -0.117 | 0.81 | 1146.8 | Rejected |
| Crypto (1 h bars) | Trend pullback (2:1) | 8830 | 35.9% | 34.9% | 37.1% | -0.106 | 0.84 | 1010.5 | Rejected |
| Crypto (4 h bars) | Breakout | 2784 | 50.3% | 48.4% | 53.0% | -0.006 | 0.98 | 117.0 | Rejected |
| Crypto (4 h bars) | Breakout (1.5:1) | 2711 | 44.8% | 42.9% | 42.4% | -0.005 | 0.99 | 141.4 | Rejected |
| Crypto (4 h bars) | Breakout (2:1) | 2686 | 43.0% | 41.1% | 35.3% | -0.005 | 0.99 | 149.4 | Rejected |
| Crypto (4 h bars) | Mean reversion | 1423 | 48.6% | 46.0% | 52.9% | -0.104 | 0.78 | 166.6 | Rejected |
| Crypto (4 h bars) | Mean reversion (1.5:1) | 1422 | 45.4% | 42.9% | 42.3% | -0.096 | 0.81 | 159.3 | Rejected |
| Crypto (4 h bars) | Mean reversion (2:1) | 1420 | 44.4% | 41.8% | 35.3% | -0.106 | 0.79 | 174.1 | Rejected |
| Crypto (4 h bars) | Trend pullback | 3711 | 47.0% | 45.4% | 52.7% | -0.067 | 0.83 | 270.3 | Rejected |
| Crypto (4 h bars) | Trend pullback (1.5:1) | 3662 | 44.6% | 43.0% | 42.2% | -0.057 | 0.86 | 248.2 | Rejected |
| Crypto (4 h bars) | Trend pullback (2:1) | 3648 | 44.1% | 42.5% | 35.1% | -0.050 | 0.88 | 216.0 | Rejected |

### Crypto: 1-hour vs 4-hour bars (all three strategies together, out-of-sample)

| Bars | Trades | Hit rate | Break-even | Expectancy (R) |
|---|---:|---:|---:|---:|
| Crypto (1 h bars) | 63,317 | 42.1% | 56.0% | -0.119 |
| Crypto (4 h bars) | 23,467 | 45.7% | 52.9% | -0.048 |

## 2. LightGBM layer (out-of-sample)

For every rule setup the model estimates P(win) from 21 features at the signal bar (trend distance and slope in ATRs, recent returns, RSI, ADX, volatility rank, squeeze, volume, time, strategy, regime). Model probability is isotonic-calibrated and blended 70/30 with the rule's history. The layer **takes** a setup only when that probability beats break-even by 3%. One model per group: crypto 1 h, crypto 4 h, daily markets pooled.

| Market | Setups | Taken by ML | Hit rate (taken) | 95% low | Break-even | Expectancy taken (R) | Expectancy all setups (R) | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Crypto (1 h bars) | 63,317 | 6,075 | 37.1% | 35.9% | 37.7% | -0.084 | -0.119 | Rejected |
| Crypto (4 h bars) | 23,467 | 14,548 | 44.4% | 43.6% | 39.2% | -0.043 | -0.048 | Rejected |

**What the models lean on most** (share of total gain, live models trained on all finished trades):

- crypto: reward 11%, dist_ema200 9%, adx 7%, bb_width_pct 7%, atr_pct 6%, ema50_slope 6%, ret_1 6%, atr_pct_rank 6%
- crypto_4h: atr_pct_rank 9%, dist_ema200 9%, atr_pct 8%, vol_ratio 8%, ret_20 7%, bb_width_pct 7%, ret_1 7%, dist_ema20 6%

## Verdict

**Nothing passed.** Neither the rules nor the LightGBM layer showed an edge that survives costs out-of-sample, so the scanner publishes no trade ideas. Setups are logged as "don't enter" and resolved, and every live crypto setup is forward-tested with demo money.

## Calibration of the rule probabilities (out-of-sample)

| Predicted bucket | Trades | Predicted | Actual |
|---|---:|---:|---:|
| (0.0, 0.4] | 25615 | 36.2% | 36.8% |
| (0.4, 0.45] | 25437 | 42.3% | 42.7% |
| (0.45, 0.5] | 24949 | 47.8% | 47.6% |
| (0.5, 0.55] | 8381 | 51.3% | 48.9% |
| (0.55, 0.6] | 1849 | 57.8% | 43.6% |
| (0.6, 1.0] | 553 | 62.0% | 52.1% |

## Calibration of the LightGBM probabilities (out-of-sample)

| Predicted bucket | Trades | Predicted | Actual |
|---|---:|---:|---:|
| (0.0, 0.4] | 29316 | 35.7% | 39.3% |
| (0.4, 0.45] | 22570 | 42.8% | 42.2% |
| (0.45, 0.5] | 27450 | 47.1% | 47.1% |
| (0.5, 0.55] | 3631 | 51.1% | 47.4% |
| (0.55, 0.6] | 127 | 56.0% | 44.9% |
| (0.6, 1.0] | 3690 | 84.0% | 43.6% |

## Out-of-sample by year

| Year | Trades | Hit rate | Expectancy (R) |
|---|---:|---:|---:|
| 2022 | 17764 | 42.8% | -0.083 |
| 2023 | 18008 | 42.0% | -0.129 |
| 2024 | 17548 | 44.8% | -0.057 |
| 2025 | 17987 | 43.2% | -0.091 |
| 2026 | 15477 | 42.4% | -0.141 |

## Data used

| Series | From | To | Bars |
|---|---|---|---:|
| ADAUSD (4h) | 2021-11-14 | 2026-11-12 | 10,949 |
| AVAXUSD (1h) | 2021-11-13 | 2026-11-12 | 43,798 |
| AVAXUSD (4h) | 2021-11-14 | 2026-11-12 | 10,949 |
| BCHUSD (1h) | 2021-11-13 | 2026-11-12 | 43,798 |
| BCHUSD (4h) | 2021-11-14 | 2026-11-12 | 10,949 |
| BNBUSD (4h) | 2021-11-14 | 2026-11-12 | 10,949 |
| BTCUSD (4h) | 2021-11-14 | 2026-11-12 | 10,949 |
| DOGEUSD (1h) | 2021-11-13 | 2026-11-12 | 43,798 |
| DOGEUSD (4h) | 2021-11-14 | 2026-11-12 | 10,949 |
| DOTUSD (1h) | 2021-11-13 | 2026-11-12 | 43,798 |
| DOTUSD (4h) | 2021-11-14 | 2026-11-12 | 10,949 |
| ETHUSD (1h) | 2021-11-13 | 2026-11-12 | 43,798 |
| ETHUSD (4h) | 2021-11-14 | 2026-11-12 | 10,949 |
| LINKUSD (1h) | 2021-11-13 | 2026-11-12 | 43,798 |
| LINKUSD (4h) | 2021-11-14 | 2026-11-12 | 10,949 |
| LTCUSD (1h) | 2021-11-13 | 2026-11-12 | 43,798 |
| LTCUSD (4h) | 2021-11-14 | 2026-11-12 | 10,949 |
| SOLUSD (1h) | 2021-11-13 | 2026-11-12 | 43,798 |
| SOLUSD (4h) | 2021-11-14 | 2026-11-12 | 10,949 |
| TRXUSD (1h) | 2021-11-13 | 2026-11-12 | 43,798 |
| TRXUSD (4h) | 2021-11-14 | 2026-11-12 | 10,949 |
| XLMUSD (1h) | 2021-11-13 | 2026-11-12 | 43,798 |
| XLMUSD (4h) | 2021-11-14 | 2026-11-12 | 10,949 |
| XRPUSD (1h) | 2021-11-13 | 2026-11-12 | 43,798 |
| XRPUSD (4h) | 2021-11-14 | 2026-11-12 | 10,949 |

_Probability, not a promise. Educational, not financial advice._
