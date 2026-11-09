# AI Spot: pre-registered strategy hypotheses

Every hypothesis below was written down, with all its settings, and committed to GitHub BEFORE it was tested.
Settings are never changed after a result is seen; a failed idea gets a new version and a new hypothesis, and
counts toward the multiple-testing penalty. Gates are those in `intel/engine/spot/backtest.py` (`Gates`).

Multiple-testing tally (strategy x symbol tests run so far): **14** after batch 2
(Bonferroni divides the 5% error rate by this number).

## Batch 1 (2026-11-09) — tested, 0 of 8 passed

| Strategy | Family | TF | Hypothesis (short) | Result |
| --- | --- | --- | --- | --- |
| strict_scalp 0.1.0 | trend pullback | 15m | EMA20 pullback in strong 15m+1h up-trend pays 1.5R | MORE_DATA |
| balanced_scalp 0.1.0 | trend pullback | 15m | Looser EMA20 pullback pays 1.2R | REJECTED |
| strict_swing 0.1.0 | trend pullback | 4h | EMA50 pullback in daily up-trend pays 2.5R | MORE_DATA |
| balanced_swing 0.1.0 | trend pullback | 4h | EMA20–50 band pullback pays 2R | REJECTED |

Lesson recorded: on 15m, costs are 0.5–0.9R per trade; scalping on spot at taker fees is not viable.
Batch 2 therefore stays on 4h, where costs are about 0.05–0.1R.

## Batch 2 (2026-11-10) — pre-registered in commit bbbdce6, then tested once: 0 of 6 passed

| Strategy | BTC/USDT | ETH/USDT | Verdict |
| --- | --- | --- | --- |
| range_reversion 0.1.0 | 11 trades, +0.23R | 8 trades, −0.65R | MORE_DATA (fires too rarely) |
| squeeze_breakout 0.1.0 | 58 trades, +0.25R | 56 trades, +0.17R | MORE_DATA |
| trend_breakout 0.1.0 | 70 trades, +0.51R | 68 trades, +0.17R | MORE_DATA |

Positive averages on fewer than 100 trades are not evidence of an edge yet; they can be luck. Settings stay
frozen. The honest way to get more evidence is forward data (shadow tracking), not re-tuning on the past.

All long-only, 4h signal bars, 1d context, costs 0.12% per side, one position per strategy and symbol.

### range_reversion 0.1.0 (mean reversion)
- **Hypothesis:** in a quiet, ranging 4h market that is not in a daily down-trend, a close below the lower
  Bollinger Band (20, 2σ) with RSI(14) < 30 snaps back toward the 20-bar mean often enough to pay after costs.
- **Why it might work:** in ranges, short-term over-extension is mostly liquidity-driven and reverts.
- **When it should fail:** at the start of a down-trend (the "range" is breaking); hence the daily filter.
- **Entry:** regime RANGING (ADX < 18), close < lower band, RSI < 30, daily context not down, volatility rank ≤ 0.90.
- **Exit:** target = the 20-bar mean (band middle) at the signal bar; stop = below the 10-bar swing low,
  at least 1.5 ATR; time stop 12 bars. Trade skipped if the target is not above the entry.

### squeeze_breakout 0.1.0 (volatility breakout)
- **Hypothesis:** after a volatility squeeze (Bollinger width in its lowest 25% within the last 5 bars),
  a 4h close above the previous 20-bar high on 1.5× median volume, in a daily up-trend, runs far enough to pay 3R.
- **Why it might work:** squeezes store energy; volume-confirmed breaks in the trend's direction tend to follow through.
- **When it should fail:** false breakouts in ranges; most breakouts fail, so the target must be large.
- **Entry filter:** no entries when volatility rank > 0.90.
- **Exit:** stop below the 10-bar swing low, at least 2 ATR; target 3R; break-even after +1R;
  time stop 30 bars unless at least +1R.

### trend_breakout 0.1.0 (trend following, Donchian)
- **Hypothesis:** a 4h close above the previous 55-bar high, with price above EMA200 and the daily trend up,
  starts moves large enough that a trailing exit at the 20-bar low earns more than it gives back.
- **Why it might work:** classic time-series momentum; crypto has historically shown long, persistent trends.
- **When it should fail:** choppy years with many failed breaks; it relies on a few large winners.
- **Exit:** initial stop below the 10-bar swing low, at least 2 ATR; no fixed target; stop trails up to the
  20-bar low (never down); no time stop.
