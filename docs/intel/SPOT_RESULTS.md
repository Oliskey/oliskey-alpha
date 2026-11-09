# AI Spot: strategy test results

Generated 2026-11-09 22:59 UTC. Real Binance spot candles (BTC/USDT, ETH/USDT). Long-only, no leverage. Costs: 0.12% per side (0.10% taker fee + 0.02% spread/slippage), re-run at 1.5x and 2x. One position per strategy and symbol; 1% risk per trade for the equity curve.

**0 of 8 strategy/symbol pairs passed every gate** and may run on PAPER only. Nothing here permits real money. A pass is evidence, not a promise: paper trading must confirm it.

Run log: the first run (2026-11-09) required swing entries to close above EMA20, which the spec does not say. That was a coding error, fixed once to match the spec (a bullish close above EMA50). Both runs: 0 of 8 passed. No parameter was tuned on results.

## Gates (fixed before the first run, never loosened)

- At least 100 trades, else MORE_DATA
- Bootstrap lower bound of expectancy > 0 at 99.38% confidence (Bonferroni over 8 tests)
- Expectancy still > 0 with costs x1.5
- At least 70% of 6 walk-forward windows profitable (windows with 10+ trades)
- The sealed most-recent 20% of history is profitable
- Bootstrap 95th-percentile drawdown <= 25% at 1% risk

## Summary

| Strategy | Symbol | TF | Trades | Win % | Avg win R | Avg loss R | Expectancy R | Lower bound R | Profit factor | Max DD | E at 1.5x | E at 2x | Sealed E | Verdict |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| strict_scalp | BTCUSDT | 15m | 15 | 6.7% | 0.60 | -1.18 | -1.065 | – | 0.04 | 14.9% | -1.499 | -1.933 | -0.925 | **MORE_DATA** |
| strict_scalp | ETHUSDT | 15m | 15 | 20.0% | 0.56 | -1.05 | -0.727 | – | 0.13 | 11.3% | -0.936 | -1.192 | -0.404 | **MORE_DATA** |
| balanced_scalp | BTCUSDT | 15m | 654 | 24.6% | 0.60 | -1.25 | -0.794 | -0.927 | 0.16 | 99.5% | -1.180 | -1.568 | -0.924 | **REJECTED** |
| balanced_scalp | ETHUSDT | 15m | 701 | 30.8% | 0.71 | -1.12 | -0.559 | -0.667 | 0.28 | 98.1% | -0.818 | -1.076 | -0.685 | **REJECTED** |
| strict_swing | BTCUSDT | 4h | 32 | 18.8% | 1.47 | -0.63 | -0.233 | – | 0.54 | 9.0% | -0.273 | -0.306 | -0.014 | **MORE_DATA** |
| strict_swing | ETHUSDT | 4h | 20 | 25.0% | 2.06 | -0.63 | +0.041 | – | 1.09 | 7.2% | +0.015 | -0.011 | -0.648 | **MORE_DATA** |
| balanced_swing | BTCUSDT | 4h | 191 | 27.2% | 1.92 | -0.67 | +0.039 | -0.205 | 1.08 | 15.2% | +0.001 | -0.030 | +0.082 | **REJECTED** |
| balanced_swing | ETHUSDT | 4h | 177 | 26.0% | 1.94 | -0.74 | -0.040 | -0.273 | 0.93 | 13.8% | -0.052 | -0.074 | -0.283 | **REJECTED** |

## Detail per strategy

### strict_scalp v0.1.0 on BTCUSDT (15m, context 1h)

Hypothesis: In a strong 15m up-trend inside a 1h up-trend, a reset pullback to EMA20 that closes back above it on rising volume continues upward often enough to pay 1.5R after costs.

Sharpe -2.19 · Sortino -0.51 · Calmar -0.61 · net return -14.9% · 0.7 trades/month · avg hold 5.3 bars · costs 0.897R per trade · capture 0.24 · exits {'stop': 7, 'time': 4, 'breakeven': 3, 'target': 1}

- PASS: trades

| Window | Trades | Expectancy R |
| --- | ---: | ---: |
| 2024-12-30 to 2025-04-22 | 3 | -1.398 |
| 2025-04-22 to 2025-08-13 | 0 | – |
| 2025-08-13 to 2025-12-04 | 2 | -1.282 |
| 2025-12-04 to 2026-03-27 | 0 | – |
| 2026-03-27 to 2026-07-19 | 6 | -1.025 |
| 2026-07-19 to 2026-11-09 | 4 | -0.766 |

| Regime at entry | Trades | Expectancy R |
| --- | ---: | ---: |
| TRANSITIONAL | 1 | -1.558 |
| TRENDING_UP | 14 | -1.030 |

### strict_scalp v0.1.0 on ETHUSDT (15m, context 1h)

Hypothesis: In a strong 15m up-trend inside a 1h up-trend, a reset pullback to EMA20 that closes back above it on rising volume continues upward often enough to pay 1.5R after costs.

Sharpe -1.85 · Sortino -0.49 · Calmar -0.58 · net return -10.4% · 0.8 trades/month · avg hold 5.0 bars · costs 0.460R per trade · capture 0.26 · exits {'stop': 8, 'time': 4, 'target': 2, 'breakeven': 1}

- PASS: trades

| Window | Trades | Expectancy R |
| --- | ---: | ---: |
| 2024-12-30 to 2025-04-22 | 2 | -0.706 |
| 2025-04-22 to 2025-08-13 | 3 | -1.429 |
| 2025-08-13 to 2025-12-04 | 3 | -0.040 |
| 2025-12-04 to 2026-03-27 | 0 | – |
| 2026-03-27 to 2026-07-19 | 3 | -1.536 |
| 2026-07-19 to 2026-11-09 | 4 | -0.121 |

| Regime at entry | Trades | Expectancy R |
| --- | ---: | ---: |
| TRENDING_UP | 15 | -0.727 |

### balanced_scalp v0.1.0 on BTCUSDT (15m, context 1h)

Hypothesis: A looser version: any EMA20 pullback in a 15m up-trend that is not against the 1h trend.

Sharpe -10.53 · Sortino -10.25 · Calmar -0.95 · net return -99.5% · 29.6 trades/month · avg hold 7.1 bars · costs 0.777R per trade · capture 0.39 · exits {'stop': 264, 'target': 194, 'time': 109, 'breakeven': 87}

- FAIL: expectancy lower bound > 0 (1x costs)
- FAIL: expectancy > 0 at 1.5x costs
- FAIL: >= 70% of folds profitable
- FAIL: sealed test (last 20%) expectancy > 0
- FAIL: bootstrap 95th pct drawdown <= 25%

| Window | Trades | Expectancy R |
| --- | ---: | ---: |
| 2024-12-30 to 2025-04-22 | 128 | -0.588 |
| 2025-04-22 to 2025-08-13 | 108 | -0.894 |
| 2025-08-13 to 2025-12-04 | 104 | -0.972 |
| 2025-12-04 to 2026-03-27 | 97 | -0.646 |
| 2026-03-27 to 2026-07-19 | 115 | -0.745 |
| 2026-07-19 to 2026-11-09 | 102 | -0.961 |

| Regime at entry | Trades | Expectancy R |
| --- | ---: | ---: |
| TRANSITIONAL | 78 | -0.805 |
| TRENDING_UP | 576 | -0.792 |

### balanced_scalp v0.1.0 on ETHUSDT (15m, context 1h)

Hypothesis: A looser version: any EMA20 pullback in a 15m up-trend that is not against the 1h trend.

Sharpe -9.55 · Sortino -10.37 · Calmar -0.90 · net return -98.1% · 31.8 trades/month · avg hold 7.1 bars · costs 0.512R per trade · capture 0.46 · exits {'stop': 305, 'target': 225, 'time': 109, 'breakeven': 62}

- FAIL: expectancy lower bound > 0 (1x costs)
- FAIL: expectancy > 0 at 1.5x costs
- FAIL: >= 70% of folds profitable
- FAIL: sealed test (last 20%) expectancy > 0
- FAIL: bootstrap 95th pct drawdown <= 25%

| Window | Trades | Expectancy R |
| --- | ---: | ---: |
| 2024-12-30 to 2025-04-22 | 110 | -0.585 |
| 2025-04-22 to 2025-08-13 | 152 | -0.467 |
| 2025-08-13 to 2025-12-04 | 110 | -0.548 |
| 2025-12-04 to 2026-03-27 | 95 | -0.412 |
| 2026-03-27 to 2026-07-19 | 111 | -0.640 |
| 2026-07-19 to 2026-11-09 | 123 | -0.697 |

| Regime at entry | Trades | Expectancy R |
| --- | ---: | ---: |
| BREAKOUT | 1 | -0.488 |
| TRANSITIONAL | 110 | -0.644 |
| TRENDING_UP | 590 | -0.543 |

### strict_swing v0.1.0 on BTCUSDT (4h, context 1d)

Hypothesis: In a confirmed daily up-trend, 4h pullbacks to EMA50 that close bullish resolve upward to 2.5R more often than the 29% a 2.5R target needs to break even after costs.

Sharpe -0.40 · Sortino -0.08 · Calmar -0.12 · net return -7.4% · 0.4 trades/month · avg hold 12.7 bars · costs 0.102R per trade · capture 0.60 · exits {'stop': 14, 'breakeven': 11, 'time': 4, 'target': 3}

- PASS: trades

| Window | Trades | Expectancy R |
| --- | ---: | ---: |
| 2017-08-17 to 2019-03-02 | 0 | – |
| 2019-03-02 to 2020-09-13 | 7 | +0.261 |
| 2020-09-13 to 2022-03-29 | 7 | -0.253 |
| 2022-03-29 to 2023-10-12 | 2 | -0.576 |
| 2023-10-12 to 2025-04-26 | 10 | -0.385 |
| 2025-04-26 to 2026-11-09 | 6 | -0.419 |

| Regime at entry | Trades | Expectancy R |
| --- | ---: | ---: |
| TRANSITIONAL | 2 | -0.576 |
| TRENDING_UP | 30 | -0.210 |

### strict_swing v0.1.0 on ETHUSDT (4h, context 1d)

Hypothesis: In a confirmed daily up-trend, 4h pullbacks to EMA50 that close bullish resolve upward to 2.5R more often than the 29% a 2.5R target needs to break even after costs.

Sharpe 0.11 · Sortino 0.02 · Calmar 0.01 · net return +0.7% · 0.2 trades/month · avg hold 14.8 bars · costs 0.070R per trade · capture 0.77 · exits {'stop': 8, 'breakeven': 5, 'target': 4, 'time': 3}

- PASS: trades

| Window | Trades | Expectancy R |
| --- | ---: | ---: |
| 2017-08-17 to 2019-03-02 | 1 | -1.028 |
| 2019-03-02 to 2020-09-13 | 3 | +1.625 |
| 2020-09-13 to 2022-03-29 | 5 | +0.667 |
| 2022-03-29 to 2023-10-12 | 3 | -0.608 |
| 2023-10-12 to 2025-04-26 | 1 | -0.000 |
| 2025-04-26 to 2026-11-09 | 7 | -0.648 |

| Regime at entry | Trades | Expectancy R |
| --- | ---: | ---: |
| TRENDING_UP | 20 | +0.041 |

### balanced_swing v0.1.0 on BTCUSDT (4h, context 1d)

Hypothesis: Pullbacks to the EMA20-EMA50 band in a 4h up-trend that is not against the daily trend.

Sharpe 0.11 · Sortino 0.06 · Calmar 0.04 · net return +6.2% · 1.8 trades/month · avg hold 18.6 bars · costs 0.075R per trade · capture 0.83 · exits {'stop': 85, 'target': 52, 'breakeven': 50, 'time': 4}

- FAIL: expectancy lower bound > 0 (1x costs)
- PASS: expectancy > 0 at 1.5x costs
- FAIL: >= 70% of folds profitable
- PASS: sealed test (last 20%) expectancy > 0
- FAIL: bootstrap 95th pct drawdown <= 25%

| Window | Trades | Expectancy R |
| --- | ---: | ---: |
| 2017-08-17 to 2019-03-02 | 26 | -0.015 |
| 2019-03-02 to 2020-09-13 | 30 | +0.142 |
| 2020-09-13 to 2022-03-29 | 41 | +0.203 |
| 2022-03-29 to 2023-10-12 | 25 | -0.375 |
| 2023-10-12 to 2025-04-26 | 38 | +0.165 |
| 2025-04-26 to 2026-11-09 | 31 | -0.054 |

| Regime at entry | Trades | Expectancy R |
| --- | ---: | ---: |
| BREAKOUT | 1 | -1.057 |
| TRANSITIONAL | 29 | -0.114 |
| TRENDING_UP | 161 | +0.073 |

### balanced_swing v0.1.0 on ETHUSDT (4h, context 1d)

Hypothesis: Pullbacks to the EMA20-EMA50 band in a 4h up-trend that is not against the daily trend.

Sharpe -0.12 · Sortino -0.07 · Calmar -0.07 · net return -8.2% · 1.6 trades/month · avg hold 17.2 bars · costs 0.055R per trade · capture 0.84 · exits {'stop': 90, 'target': 46, 'breakeven': 36, 'time': 5}

- FAIL: expectancy lower bound > 0 (1x costs)
- FAIL: expectancy > 0 at 1.5x costs
- FAIL: >= 70% of folds profitable
- FAIL: sealed test (last 20%) expectancy > 0
- FAIL: bootstrap 95th pct drawdown <= 25%

| Window | Trades | Expectancy R |
| --- | ---: | ---: |
| 2017-08-17 to 2019-03-02 | 19 | -0.087 |
| 2019-03-02 to 2020-09-13 | 36 | +0.095 |
| 2020-09-13 to 2022-03-29 | 38 | +0.043 |
| 2022-03-29 to 2023-10-12 | 25 | -0.105 |
| 2023-10-12 to 2025-04-26 | 26 | +0.054 |
| 2025-04-26 to 2026-11-09 | 33 | -0.283 |

| Regime at entry | Trades | Expectancy R |
| --- | ---: | ---: |
| TRANSITIONAL | 17 | -0.404 |
| TRENDING_UP | 160 | -0.002 |

## Market state now (4h)

- BTCUSDT: **TRENDING_DOWN**, direction DOWN, ADX 38.9, volatility percentile 66, uncertainty 0.0
- ETHUSDT: **TRENDING_DOWN**, direction DOWN, ADX 36.4, volatility percentile 86, uncertainty 0.0
