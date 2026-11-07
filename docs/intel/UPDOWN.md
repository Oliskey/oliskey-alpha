# Up/Down study for Fixed Time trades

Generated 2026-10-30 13:47 UTC from 2,627,340 one-minute candle closes (BTC, ETH, SOL, BNB, XRP, last 365 days of real Binance data). No look-ahead check: passed.

**Question:** at the close of a 1-minute candle, will the price be higher or lower 1 or 5 minutes later? A Fixed Time trade pays +85% on a win and loses the stake on a loss, so it needs a win rate above **54.05%** to make money. Equal prices are refunds and are left out.

**Method:** LightGBM on price moves (1-60 min), RSI, volatility, volume, taker-buy imbalance (real buyer vs seller pressure), time of day and coin. Walk-forward by month: every month is predicted by a model trained only on earlier months, probabilities calibrated on held-out data. A trade is taken only when the model's chance beats break-even by 1%. Accepted only with >= 200 taken trades, the 95% lower bound of the win rate above break-even, and the 95% lower bound of the average result above zero.

| Horizon | Possible trades | Hit rate if taking all | Trades taken | Win rate taken | 95% low | Break-even | Avg result per α1 | 95% low | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 min | 2,065,687 | 51.35% | 93,307 | 54.44% | 54.12% | 54.05% | +0.007 | +0.001 | **Accepted** |
| 5 min | 2,141,959 | 51.79% | 198,662 | 54.94% | 54.72% | 54.05% | +0.016 | +0.012 | **Accepted** |

Taken trades by month (1 min):

| Month | Trades | Win rate |
|---|---:|---:|
| 2026-01 | 21,637 | 53.8% |
| 2026-02 | 14,342 | 52.9% |
| 2026-03 | 16,883 | 53.9% |
| 2026-04 | 4,024 | 54.4% |
| 2026-05 | 1,379 | 61.4% |
| 2026-06 | 6,868 | 54.1% |
| 2026-07 | 1,922 | 59.8% |
| 2026-08 | 18,606 | 55.2% |
| 2026-09 | 4,131 | 55.1% |
| 2026-10 | 3,515 | 57.8% |

Taken trades by month (5 min):

| Month | Trades | Win rate |
|---|---:|---:|
| 2026-01 | 15,844 | 54.1% |
| 2026-02 | 31,890 | 54.8% |
| 2026-03 | 45,495 | 54.7% |
| 2026-04 | 15,559 | 55.2% |
| 2026-05 | 23,294 | 55.1% |
| 2026-06 | 22,517 | 55.3% |
| 2026-07 | 15,140 | 55.5% |
| 2026-08 | 20,655 | 54.3% |
| 2026-09 | 4,392 | 56.7% |
| 2026-10 | 3,876 | 56.9% |

## Verdict

**Accepted:** 1 min, 5 min. Forward-test with demo money before trusting it.

Run time 2682 s.
