# Market Intelligence Engine: walk-forward results

Generated 2026-10-30 13:00 UTC from 117 market/timeframe series, 373,875 simulated trades (361,376 out-of-sample).

**How to read this.** Every trade risks 1R (stop 1.5 ATR) and aims for 1R, 1.5R or 2R (the "(1.5:1)" and "(2:1)" versions). *Break-even* is the hit rate needed to cover costs: (1 + cost) / (1 + R). A strategy is **accepted** only if, out-of-sample, it has at least 200 trades, the 95% lower bound of its hit rate is above break-even, and the 95% lower bound of its average result (expectancy, in R) is above zero - with targets above 1:1 many "wins" are small time exits, so the hit rate alone is not enough. Out-of-sample = every calendar year after the first; each year's probabilities and models come only from earlier years. Same-bar stop+target counts as a loss.

## 1. Rule strategies (out-of-sample)

| Market | Strategy | Trades | Hit rate | 95% low | Break-even | Expectancy (R) | Profit factor | Max drawdown (R) | Verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| Commodities (daily) | Breakout | 42 | 78.6% | 64.1% | 50.6% | +0.584 | 4.04 | 3.0 | Rejected |
| Commodities (daily) | Breakout (1.5:1) | 40 | 65.0% | 49.5% | 40.5% | +0.570 | 3.22 | 3.0 | Rejected |
| Commodities (daily) | Breakout (2:1) | 39 | 59.0% | 43.4% | 33.7% | +0.618 | 3.03 | 3.0 | Rejected |
| Commodities (daily) | Mean reversion | 30 | 56.7% | 39.2% | 50.6% | +0.096 | 1.23 | 3.0 | Rejected |
| Commodities (daily) | Mean reversion (1.5:1) | 30 | 53.3% | 36.1% | 40.5% | +0.050 | 1.11 | 4.0 | Rejected |
| Commodities (daily) | Mean reversion (2:1) | 29 | 51.7% | 34.4% | 33.7% | -0.021 | 0.96 | 5.4 | Rejected |
| Commodities (daily) | Trend pullback | 64 | 53.1% | 41.1% | 50.6% | +0.028 | 1.07 | 8.0 | Rejected |
| Commodities (daily) | Trend pullback (1.5:1) | 61 | 49.2% | 37.1% | 40.5% | +0.054 | 1.13 | 6.9 | Rejected |
| Commodities (daily) | Trend pullback (2:1) | 60 | 48.3% | 36.2% | 33.7% | +0.053 | 1.12 | 7.5 | Rejected |
| Crypto (1 h bars) | Breakout | 35977 | 50.2% | 49.6% | 55.1% | -0.095 | 0.82 | 3511.9 | Rejected |
| Crypto (1 h bars) | Breakout (1.5:1) | 34483 | 41.4% | 40.9% | 44.1% | -0.077 | 0.88 | 2800.2 | Rejected |
| Crypto (1 h bars) | Breakout (2:1) | 33687 | 36.2% | 35.7% | 36.8% | -0.073 | 0.89 | 2701.8 | Rejected |
| Crypto (1 h bars) | Mean reversion | 16187 | 48.3% | 47.5% | 54.9% | -0.129 | 0.77 | 2135.0 | Rejected |
| Crypto (1 h bars) | Mean reversion (1.5:1) | 15977 | 39.3% | 38.5% | 44.0% | -0.136 | 0.79 | 2208.0 | Rejected |
| Crypto (1 h bars) | Mean reversion (2:1) | 15900 | 35.1% | 34.4% | 36.6% | -0.126 | 0.82 | 2024.1 | Rejected |
| Crypto (1 h bars) | Trend pullback | 45740 | 49.4% | 48.9% | 54.7% | -0.099 | 0.82 | 4619.3 | Rejected |
| Crypto (1 h bars) | Trend pullback (1.5:1) | 41998 | 40.6% | 40.2% | 43.7% | -0.094 | 0.85 | 4078.6 | Rejected |
| Crypto (1 h bars) | Trend pullback (2:1) | 39852 | 36.2% | 35.7% | 36.4% | -0.088 | 0.87 | 3763.5 | Rejected |
| Crypto (4 h bars) | Breakout | 9018 | 50.1% | 49.0% | 52.4% | +0.004 | 1.01 | 321.6 | Rejected |
| Crypto (4 h bars) | Breakout (1.5:1) | 8786 | 44.7% | 43.6% | 41.9% | +0.002 | 1.00 | 345.0 | Rejected |
| Crypto (4 h bars) | Breakout (2:1) | 8709 | 43.0% | 42.0% | 34.9% | +0.009 | 1.02 | 328.5 | Rejected |
| Crypto (4 h bars) | Mean reversion | 4644 | 47.8% | 46.4% | 52.3% | -0.107 | 0.77 | 530.6 | Rejected |
| Crypto (4 h bars) | Mean reversion (1.5:1) | 4627 | 44.4% | 43.0% | 41.9% | -0.107 | 0.78 | 541.5 | Rejected |
| Crypto (4 h bars) | Mean reversion (2:1) | 4622 | 43.5% | 42.1% | 34.9% | -0.118 | 0.76 | 585.8 | Rejected |
| Crypto (4 h bars) | Trend pullback | 13195 | 48.3% | 47.5% | 52.2% | -0.042 | 0.89 | 592.4 | Rejected |
| Crypto (4 h bars) | Trend pullback (1.5:1) | 12997 | 46.0% | 45.1% | 41.7% | -0.035 | 0.91 | 564.9 | Rejected |
| Crypto (4 h bars) | Trend pullback (2:1) | 12950 | 45.4% | 44.5% | 34.8% | -0.035 | 0.91 | 599.2 | Rejected |
| Forex (daily) | Breakout | 70 | 45.7% | 34.6% | 50.5% | -0.098 | 0.80 | 11.2 | Rejected |
| Forex (daily) | Breakout (1.5:1) | 68 | 45.6% | 34.3% | 40.4% | +0.029 | 1.06 | 12.9 | Rejected |
| Forex (daily) | Breakout (2:1) | 68 | 42.6% | 31.6% | 33.7% | -0.050 | 0.90 | 14.2 | Rejected |
| Forex (daily) | Mean reversion | 82 | 46.3% | 36.0% | 50.5% | -0.078 | 0.84 | 14.4 | Rejected |
| Forex (daily) | Mean reversion (1.5:1) | 81 | 40.7% | 30.7% | 40.4% | -0.082 | 0.85 | 16.2 | Rejected |
| Forex (daily) | Mean reversion (2:1) | 81 | 40.7% | 30.7% | 33.7% | -0.068 | 0.87 | 17.0 | Rejected |
| Forex (daily) | Trend pullback | 213 | 50.7% | 44.0% | 50.5% | -0.029 | 0.94 | 11.1 | Rejected |
| Forex (daily) | Trend pullback (1.5:1) | 205 | 43.9% | 37.3% | 40.4% | -0.065 | 0.87 | 16.9 | Rejected |
| Forex (daily) | Trend pullback (2:1) | 203 | 42.4% | 35.8% | 33.7% | -0.058 | 0.89 | 17.3 | Rejected |
| Indices (daily) | Breakout | 46 | 45.7% | 32.2% | 50.9% | -0.091 | 0.81 | 7.7 | Rejected |
| Indices (daily) | Breakout (1.5:1) | 43 | 44.2% | 30.4% | 40.7% | +0.016 | 1.03 | 7.1 | Rejected |
| Indices (daily) | Breakout (2:1) | 43 | 41.9% | 28.4% | 33.9% | -0.012 | 0.98 | 8.2 | Rejected |
| Indices (daily) | Mean reversion | 40 | 50.0% | 35.2% | 50.8% | +0.008 | 1.02 | 7.7 | Rejected |
| Indices (daily) | Mean reversion (1.5:1) | 40 | 42.5% | 28.5% | 40.7% | -0.004 | 0.99 | 11.7 | Rejected |
| Indices (daily) | Mean reversion (2:1) | 40 | 42.5% | 28.5% | 33.9% | +0.080 | 1.15 | 11.2 | Rejected |
| Indices (daily) | Trend pullback | 106 | 53.8% | 44.3% | 50.9% | +0.053 | 1.12 | 19.5 | Rejected |
| Indices (daily) | Trend pullback (1.5:1) | 104 | 50.0% | 40.6% | 40.7% | +0.153 | 1.32 | 19.1 | Rejected |
| Indices (daily) | Trend pullback (2:1) | 99 | 44.4% | 35.0% | 33.9% | +0.050 | 1.10 | 19.8 | Rejected |

### Crypto: 1-hour vs 4-hour bars (all three strategies together, out-of-sample)

| Bars | Trades | Hit rate | Break-even | Expectancy (R) |
|---|---:|---:|---:|---:|
| Crypto (1 h bars) | 279,801 | 42.3% | 54.9% | -0.096 |
| Crypto (4 h bars) | 79,548 | 46.1% | 52.3% | -0.036 |

## 2. LightGBM layer (out-of-sample)

For every rule setup the model estimates P(win) from 21 features at the signal bar (trend distance and slope in ATRs, recent returns, RSI, ADX, volatility rank, squeeze, volume, time, strategy, regime). Model probability is isotonic-calibrated and blended 70/30 with the rule's history. The layer **takes** a setup only when that probability beats break-even by 3%. One model per group: crypto 1 h, crypto 4 h, daily markets pooled.

| Market | Setups | Taken by ML | Hit rate (taken) | 95% low | Break-even | Expectancy taken (R) | Expectancy all setups (R) | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Commodities (daily) | 395 | 222 | 58.1% | 51.5% | 39.0% | +0.274 | +0.211 | **Accepted** |
| Crypto (1 h bars) | 279,801 | 33,872 | 38.4% | 37.9% | 37.1% | -0.040 | -0.096 | Rejected |
| Crypto (4 h bars) | 79,548 | 52,341 | 45.3% | 44.8% | 39.2% | -0.029 | -0.036 | Rejected |
| Forex (daily) | 1,071 | 607 | 45.5% | 41.5% | 39.1% | -0.034 | -0.054 | Rejected |
| Indices (daily) | 561 | 251 | 46.2% | 40.2% | 39.3% | +0.054 | +0.046 | Rejected |

**What the models lean on most** (share of total gain, live models trained on all finished trades):

- crypto: reward 23%, weekday 9%, hour 8%, dist_ema200 7%, atr_pct 6%, atr_pct_rank 6%, ema50_slope 6%, ret_1 5%
- crypto_4h: atr_pct_rank 10%, dist_ema200 9%, weekday 8%, atr_pct 8%, ret_1 7%, bb_width_pct 6%, ret_5 6%, ema50_slope 6%
- daily: vol_ratio 10%, close_loc 9%, atr_pct 8%, atr_pct_rank 8%, dist_ema50 8%, ret_5 7%, ret_1 7%, dist_ema200 7%

## Verdict

Accepted (the scanner publishes ideas only from these): LightGBM layer on Commodities (daily).

## Calibration of the rule probabilities (out-of-sample)

| Predicted bucket | Trades | Predicted | Actual |
|---|---:|---:|---:|
| (0.0, 0.4] | 121823 | 36.8% | 37.2% |
| (0.4, 0.45] | 78609 | 41.6% | 41.6% |
| (0.45, 0.5] | 125509 | 48.1% | 48.4% |
| (0.5, 0.55] | 28615 | 51.4% | 48.4% |
| (0.55, 0.6] | 4878 | 57.9% | 46.3% |
| (0.6, 1.0] | 1942 | 60.3% | 51.5% |

## Calibration of the LightGBM probabilities (out-of-sample)

| Predicted bucket | Trades | Predicted | Actual |
|---|---:|---:|---:|
| (0.0, 0.4] | 106443 | 36.4% | 37.2% |
| (0.4, 0.45] | 97778 | 42.6% | 42.2% |
| (0.45, 0.5] | 125037 | 47.1% | 47.7% |
| (0.5, 0.55] | 19664 | 51.7% | 49.4% |
| (0.55, 0.6] | 6226 | 58.2% | 46.3% |
| (0.6, 1.0] | 6228 | 62.4% | 47.2% |

## Out-of-sample by year

| Year | Trades | Hit rate | Expectancy (R) |
|---|---:|---:|---:|
| 2022 | 76345 | 43.3% | -0.067 |
| 2023 | 75751 | 42.4% | -0.107 |
| 2024 | 73524 | 44.0% | -0.055 |
| 2025 | 74378 | 43.5% | -0.074 |
| 2026 | 61378 | 42.6% | -0.110 |

## Data used

| Series | From | To | Bars |
|---|---|---|---:|
| 1INCHUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| 1INCHUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| AAVEUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| AAVEUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| ADAUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| ADAUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| ALGOUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| ALGOUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| ATOMUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| ATOMUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| AUDUSD (1d) | 2021-01-01 | 2026-10-29 | 1,603 |
| AVAXUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| AVAXUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| AXSUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| AXSUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| BATUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| BATUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| BCHUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| BCHUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| BNBUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| BNBUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| BTCUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| BTCUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| CHZUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| CHZUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| COMPUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| COMPUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| CRVUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| CRVUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| DASHUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| DASHUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| DOGEUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| DOGEUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| DOTUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| DOTUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| EGLDUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| EGLDUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| ENJUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| ENJUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| ETCUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| ETCUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| ETHUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| ETHUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| EU50 (1d) | 2021-01-04 | 2026-10-29 | 1,486 |
| EURUSD (1d) | 2021-01-04 | 2026-10-29 | 1,598 |
| FETUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| FETUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| FILUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| FILUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| GBPUSD (1d) | 2021-01-01 | 2026-10-29 | 1,603 |
| GRTUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| GRTUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| HBARUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| HBARUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| HK50 (1d) | 2021-01-04 | 2026-10-29 | 1,438 |
| INJUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| INJUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| JP225 (1d) | 2021-01-04 | 2026-10-29 | 1,423 |
| KAVAUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| KAVAUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| LINKUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| LINKUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| LTCUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| LTCUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| MANAUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| MANAUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| NEARUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| NEARUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| NEOUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| NEOUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| NZDUSD (1d) | 2021-01-01 | 2026-10-29 | 1,602 |
| ONTUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| ONTUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| QTUMUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| QTUMUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| RUNEUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| RUNEUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| SANDUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| SANDUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| SNXUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| SNXUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| SOLUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| SOLUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| STXUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| STXUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| SUSHIUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| SUSHIUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| THETAUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| THETAUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| TRXUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| TRXUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| UK100 (1d) | 2021-01-04 | 2026-10-29 | 1,475 |
| UKOIL (1d) | 2021-01-04 | 2026-10-29 | 1,545 |
| UNIUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| UNIUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| US30 (1d) | 2021-01-04 | 2026-10-29 | 1,463 |
| US500 (1d) | 2021-01-04 | 2026-10-29 | 1,463 |
| USDCAD (1d) | 2021-01-01 | 2026-10-29 | 1,765 |
| USDCHF (1d) | 2021-01-01 | 2026-10-29 | 1,643 |
| USDJPY (1d) | 2021-01-01 | 2026-10-29 | 1,611 |
| USDMXN (1d) | 2021-01-01 | 2026-10-29 | 1,611 |
| VETUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| VETUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| XAGUSD (1d) | 2021-01-04 | 2026-10-29 | 1,544 |
| XAUUSD (1d) | 2021-01-04 | 2026-10-29 | 1,544 |
| XLMUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| XLMUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| XRPUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| XRPUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| XTZUSD (1h) | 2021-10-31 | 2026-10-30 | 43,799 |
| XTZUSD (4h) | 2021-10-31 | 2026-10-30 | 10,950 |
| YFIUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| YFIUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| ZECUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| ZECUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |
| ZILUSD (1h) | 2021-10-31 | 2026-10-30 | 43,798 |
| ZILUSD (4h) | 2021-10-31 | 2026-10-30 | 10,949 |

_Probability, not a promise. Educational, not financial advice._
