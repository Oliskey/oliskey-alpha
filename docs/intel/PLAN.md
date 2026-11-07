# Market Intelligence Engine: plan (v1)

Python service in `intel/` that scans real markets, suggests trades (direction, entry, stop, target, how long to
hold), says when NOT to enter, and keeps an honest track record of every idea, taken or not.

## Ground truth
- Works on real market data only. In the app, crypto now uses live Binance prices; forex, indices and commodities
  are still simulated in the app, so ideas for those apply to the real markets, not to in-app trades.
- No system predicts markets reliably. Every idea carries a probability measured out-of-sample, never a promise.

## Data (what the current keys allow, checked 2026-10-30)
| Class | Source | Bars | Assets |
|---|---|---|---|
| Crypto | Binance public API | 1 h, 3 years | 17 (all except Toncoin, not listed on Binance) |
| Forex | FMP free plan | daily, 2021+ | EURUSD GBPUSD USDJPY AUDUSD NZDUSD USDCAD USDCHF USDMXN |
| Indices | FMP free plan | daily, 2021+ | US500 US30 UK100 EU50 JP225 HK50 |
| Commodities | FMP free plan | daily, 2021+ | Gold, Silver, Brent |
Blocked on the free FMP plan: intraday forex/indices/commodities, news, economic calendar, and the other 41 assets.
Free FMP allows 250 calls/day, so daily bars refresh every 3 h (17 calls each time).

## Modules (v1)
1. `engine/data.py`: fetch + cache bars in Postgres schema `intel` (incremental after the first load).
2. `engine/indicators.py`: EMA 20/50/200, RSI 14, ATR 14, ADX 14, Bollinger 20/2, Donchian 20 (pandas only).
3. `engine/strategies.py`: regime (trend up / trend down / range / chaos) + three fixed-rule strategies:
   trend pullback, breakout from a squeeze, mean reversion in a range. Parameters are fixed in advance, never
   tuned on the data, so there is nothing to overfit.
4. `engine/backtest.py`: every signal becomes a trade: entry next bar open, stop 1.5 ATR, target 1.5 ATR (1:1),
   horizon 24 h (crypto) / 10 days (daily); same-bar stop+target counts as a loss; costs included.
   Walk-forward by calendar year: each year's probabilities come only from earlier years.
   A strategy/class is accepted only with >= 200 out-of-sample trades and a 95% lower bound on hit rate above
   break-even (after costs) and positive expectancy.
5. `engine/scanner.py`: every 5 min, each covered asset gets one status: trade idea (accepted strategy fired),
   don't enter (setup found but strategy not proven, or chaotic volatility), or wait (no setup).
6. `engine/tracking.py`: every published idea is stored before its outcome and resolved automatically
   (won / lost / expired with result in R), whether or not the user traded it.
7. `api.py`: FastAPI on 127.0.0.1:3312 (internal); the Node backend proxies it at /intel/* with login.

## Later (v2)
LightGBM layer with isotonic calibration, news/event risk (needs FMP upgrade or another news source),
intraday forex/indices/commodities (needs a paid intraday feed), regime HMM, Solana on-chain flow (Birdeye/Helius).
