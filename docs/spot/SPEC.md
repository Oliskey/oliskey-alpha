> Copy of the shared spec (2026-11-09) that this code was built against. The two diagrams live in the online doc.

# Oliskey AI Trading — Architecture & Specification

Nov 9, 2026 · @olamide

## Part A — Executive summary

Oliskey AI Trading is an evidence-gated, multi-agent decision system for BTC/USDT and ETH/USDT spot, long-only, no leverage, paper first. It is not a bot that fires on indicators: every trade must pass a chain of independent checks (market regime → strategy eligibility → entry timing → deterministic risk → execution cost), and every change to the system must pass the same research-and-promotion gate before it touches money.

**What makes it different from a simple bot**

| Simple bot | Oliskey |
| --- | --- |
| One strategy, always on | A roster of versioned strategies; the one suited to the current regime is selected, or none (NO\_TRADE) |
| Signal = order | Signal → TradeProposal → risk-approved proposal → executable order, each a separate audited record |
| Win rate as the score | Net expectancy after fees, spread and slippage, drawdown and statistical confidence |
| Tuned by hand on a backtest | Walk-forward and out-of-sample validation, multiple-testing control, champion–challenger promotion |
| Learns nothing, or rewrites itself live | Agents propose improvements; changes are tested, paper-traded, approved, then deployed, and can be rolled back |
| Risk inside the strategy | A separate deterministic Risk Manager with a persistent kill switch that no AI can override |

**Design principle.** "13 AI responsibilities" is a division of labour, not 13 LLMs. Most responsibilities are deterministic code or validated statistical models; LLMs are used where language or open-ended research helps (hypothesis writing, news reading, explaining decisions, improvement reports), and never on the money path without a deterministic check after them.

**Starting point (your repo, v0.0.21).** Oliskey Alpha already has the right skeleton: an Express backend that is the only place trades settle, Supabase Postgres with money changed only through SQL functions, a real-money gate (`live_trading_enabled`), and a Python intel engine (FastAPI, pandas, LightGBM) with walk-forward backtests, Wilson lower bounds, a trade journal, root-cause tagging and an adopt-only-if-proven rule. That engine targets Fixed Time and InZone contracts. This specification extends it to spot trading and formalises the agent, research and collaboration layers around what already works, rather than starting over.

**Honest expectation.** No part of this design guarantees profit. Its job is to find out, with measured evidence, whether an edge exists after costs, to trade only while that evidence holds, and to stop losses from compounding when it doesn't.

## Part B — Core mission

The mission is a positive net expectancy over a statistically meaningful sample, after all costs, with drawdown held inside limits the owner sets in advance. Everything else serves that.

**The four duties, in priority order**

1. **Protect capital.** Hard limits (risk per trade, daily loss, drawdown, exposure) are enforced by deterministic code and a persistent kill switch. If anything is uncertain, the system does less, not more.
2. **Trade only with evidence.** A strategy trades only while its measured edge (lower confidence bound on net expectancy) is above zero in the current regime. NO\_TRADE is a valid and frequent output.
3. **Control avoidable losses.** Exit intelligence, time stops and strategy-health monitoring cut trades and strategies whose original hypothesis no longer holds.
4. **Improve continuously, under control.** Every agent can propose changes; every change goes through hypothesis → test → paper → approval → monitored deployment, and is reversible.

**How "winning" is measured.** Net expectancy per trade is the core number:

```latex
E = p \cdot \bar{W} - (1 - p) \cdot \bar{L} - \bar{C}
```

where p is the win rate, W̄ the average net win, L̄ the average net loss and C̄ the average cost (fees + spread + slippage). A 56% win rate is profitable only if W̄/L̄ and costs allow it: at a 1:1 reward-to-risk and 0.2% round-trip cost on a 1% stop, break-even is about 60%, not 50%. Win rate is therefore reported, never optimised alone.

**What a sample "large enough" means.** No verdict below 100 closed trades per strategy per regime; promotion requires the 95% lower bound of expectancy to be above zero (Part F). Your current engine already uses this logic (Wilson and expectancy lower bounds), and it carries over.

**Never-list (enforced in code, not in prompts):** guaranteeing profit; trading to hit a target; raising risk after losses (no martingale); changing a strategy from one trade; treating raw model confidence as probability; optimising for win rate alone; any AI path around the Risk Manager; deploying an untested change.

## Part C — Complete AI team

The 13 responsibilities map to five kinds of component; only four of them use an LLM at all, and none of those sits on the order path without a deterministic gate after it.

**Component kinds:** D = deterministic service (plain code, fully testable) · Q = quantitative/statistical model (validated, calibrated) · L = LLM agent (language, research, explanation) · X = execution service · I = shared infrastructure.

| # | Responsibility | Kind | Main inputs | Main outputs | Decision boundary (what it may NOT do) |
| --- | --- | --- | --- | --- | --- |
| 1 | Market Intelligence | Q + D (L for news summary) | Validated multi-timeframe candles, features, spread, news, sentiment | MarketState: regime, trend direction/strength, volatility percentile, momentum, S/R levels, uncertainty, recommended/avoid categories, data-quality flag | Cannot propose trades; returns UNKNOWN when evidence is thin |
| 2 | Strategy Discovery | L + Q | Knowledge base, failed experiments, performance gaps | Strategy hypotheses and draft strategy specs (version 0) | Cannot backtest its own ideas to approval or deploy anything |
| 3 | Strategy Testing | D + Q | Strategy spec, historical data, cost model | Backtest/walk-forward reports, verdict PASS / FAIL / MORE\_DATA | Cannot change the strategy it tests; cannot see test-set data until final run |
| 4 | Strategy Selection | Q + D | MarketState, strategy health, regime-conditional stats, exposure | Eligible strategy set with scores, or NO\_TRADE | Cannot size positions or override health pauses |
| 5 | Strategy Allocation | Q (constrained optimiser) | Eligible set, uncertainty, correlation, equity, risk budgets | Risk budget per strategy (% equity at risk) | Cannot exceed hard limits set in risk config |
| 6 | Entry Timing | D + Q | Signal, live bid/ask, structure, invalidation level | ENTER\_NOW / WAIT\_FOR\_PULLBACK / WAIT\_FOR\_BREAKOUT\_CONFIRMATION / WAIT\_FOR\_CANDLE\_CLOSE / REJECT\_ENTRY / NO\_TRADE | Cannot widen a stop or move an entry beyond the signal's validity window |
| 7 | Trade Duration | Q | Strategy type, regime, volatility, historical time-to-target | Expected holding range, max holding time, time-invalidation rules | Cannot close trades itself; feeds Exit |
| 8 | Exit Intelligence | D (strategy exit rules) + Q (validated models only) | Open position, live price, MarketState, duration estimate | HOLD / PROTECT / PARTIAL\_EXIT / CLOSE / INVALIDATE / TIME\_EXIT | Cannot loosen a stop; cannot act on unvalidated predictions; Risk mandatory exits always win |
| 9 | Risk Management | **D only** | Proposal, account state, exchange filters, risk config | APPROVED (with final qty and actual risk) / REJECTED (reasons); kill switch; mandatory exits | Not overridable by any agent, ever |
| 10 | Execution Intelligence | X + Q | Approved order, order book, spread, rate limits | Order type and placement, fills, reconciliation | Cannot change qty, stop or risk without re-approval |
| 11 | Performance Learning | Q + L (write-ups) | Trade journal, decisions, rejected signals, MFE/MAE | Decision-quality vs outcome analysis, weakness reports, hypotheses | Cannot change live behaviour; only files proposals |
| 12 | Strategy Recovery | D (health rules) + Q + L | Strategy health metrics | Risk-reduce / pause actions (by predefined rule), recovery candidates | Cannot rewrite or redeploy a live strategy |
| 13 | Collaborative Intelligence | L + I | Improvement reports, agent registry, knowledge base | Routing of improvements, conflict reports, adoption tracking | Cannot trade, override Risk, or promote unvalidated changes |

**Two extra roles the pipeline needs** (named in your prompt's §30 and implied elsewhere): the **Trading Supervisor** (D) merges strategy signals and resolves conflicts before Risk, and the **Promotion Gate** (D + human approval) is the only path from research to paper to live.

**How they work together — the decision loop (every closed candle):**

1. Data is ingested and validated; if quality fails, the cycle stops at NO\_TRADE.
2. Market Intelligence publishes a MarketState.
3. Strategy Selection filters approved strategies by regime fit and health; Allocation assigns risk budgets.
4. Each selected strategy evaluates its own rules and emits signals.
5. The Trading Supervisor resolves conflicts and forms TradeProposals.
6. Entry Timing decides now / wait / reject; Trade Duration attaches the holding plan.
7. Risk Management sizes and approves or rejects (deterministic).
8. Execution places and manages the order; Exit monitors the position until it closes.
9. Every step is journalled; Performance Learning and Strategy Recovery review outcomes; Collaborative Intelligence routes findings; Discovery and Testing run the research loop beside, never inside, the live loop.

## Part D — Four initial strategies

The four starters are two trading horizons (scalp, swing) × two filter strictness levels (strict, balanced). "Strict" demands more confirmations and trades less; "balanced" accepts more trades with lower per-trade quality. All four are long-only trend/pullback logic, because that is the simplest hypothesis that fits long-only spot. All parameters below are **starting hypotheses to be tested, not proven settings**.

|  | Strict Scalping | Balanced Scalping | Strict Swing | Balanced Swing |
| --- | --- | --- | --- | --- |
| Signal timeframe | 5m | 5m | 4h | 4h |
| Context timeframe | 1h trend must be up | 1h not down | 1d trend must be up | 1d not down |
| Regime required | Trending up, normal volatility | Trending up or ranging-with-up-bias | Trending up | Trending up or early breakout |
| Trend test | EMA20 > EMA50, both rising; ADX(14) ≥ 25 (strength only) | EMA20 > EMA50; ADX ≥ 20 | Close > EMA50 > EMA200, higher swing low | Close > EMA50, EMA50 rising |
| Entry trigger | Pullback to EMA20 + bullish close back above it, RSI 40–55 turning up, volume ≥ 1.2× 20-bar median | Pullback to EMA20 zone + bullish close | Pullback to EMA50 or prior breakout level, daily RSI not > 70, bullish 4h close | Pullback to EMA20/50 band, bullish 4h close |
| Stop | Below pullback swing low, min 0.8 × ATR(14) | 1.0 × ATR below entry or swing low | Below swing low, min 1.5 × ATR(14) | 2.0 × ATR below entry |
| Target | 1.5R, then trail | 1.2R partial, trail rest | 2.5R, trail by 4h swing lows | 2R partial, trail rest |
| Time stop | 12 bars (1h) if < 0.5R | 18 bars | 30 bars (5 days) if < 1R | 42 bars (7 days) |
| Min expected net R:R after costs | 1.3 | 1.1 | 2.0 | 1.6 |
| Max spread to enter | 0.03% | 0.05% | 0.10% | 0.10% |
| No-trade conditions | High-impact event within 30 min; volatility percentile > 90; spread filter fails | Same | High-impact event within 4h; daily close below EMA200 | Daily close below EMA200 |

**Why scalping is the hardest to make profitable.** A 5m stop on BTC is often 0.3–0.6% away. A taker round trip on most spot venues is \~0.2% before slippage, so costs can be a third or more of the risk. Scalping strategies must therefore be tested on maker-fee assumptions *and* taker-fee assumptions, and are expected to fail more often than swing. Your existing engine's finding that shorter InZone trades earned less per trade points the same way.

**Evaluated separately.** Each of the four has its own record, its own health monitor and its own champion–challenger slot. Scalping and swing are never pooled into one win rate.

**Regime fit summary:** all four are designed for up-trends; in down-trends and high-uncertainty regimes the correct output is NO\_TRADE until a validated long-only mean-reversion or breakout strategy (Part E) earns its place.

## Part E — Strategy discovery

Discovery produces hypotheses and machine-readable strategy specs; it never approves them. The LLM's job is to propose and document ideas; quantitative code turns them into rules; Testing (Part F) decides.

**Research families and long-only spot adaptations**

| Family | Example hypotheses for long-only BTC/ETH | Data needed | Main trap |
| --- | --- | --- | --- |
| Technical (RSI, EMA, MACD, candles, S/R, Bollinger, volume, momentum) | Bullish engulfing at tested support with volume expansion | OHLCV | Pattern mining on noise |
| Trend-following | Multi-timeframe alignment (1d, 4h, 1h all up) + pullback entry | OHLCV, multi-TF | Late entries, whipsaw in ranges |
| Mean-reversion | Buy close below lower Bollinger (2σ) in a ranging regime with RSI < 30, exit at the mean | OHLCV, regime label | Catching a falling knife in a regime shift |
| Breakout | Close above 20-bar range high after volatility contraction, volume ≥ 1.5× median; failed-breakout filter | OHLCV, ATR percentile | Most breakouts fail; cost of false starts |
| Volume | Volume-weighted pullbacks; on-balance-volume divergence | OHLCV, trades | Exchange-specific volume quirks |
| News-based | Avoid or delay entries around scheduled macro events; buy only after a confirmed positive reaction | Economic calendar, news feed with timestamps | Stale or duplicated news; look-ahead in timestamps |
| Sentiment | Fear & Greed extremes as filters (not triggers); funding-rate stretch as a long-entry veto | Sentiment index, perp funding (read only) | Weak, slow signals; data availability |
| Quantitative | Gradient-boosted classifier of "reaches +1R before −1R" with calibrated output | Engineered features, labels | Overfitting, leakage |
| Volatility | Enter on contraction-to-expansion; size by realised volatility | ATR, realised vol | Thresholds must be percentiles per asset/TF |
| Hybrid | Trend strategy that only trades when the regime model says trend and no event is near | All of the above | Complexity without added edge |

**The 18-step lifecycle (enforced as statuses in the `strategy_versions` table):**

1. Opportunity identified (source: Performance Learning gap, research idea, literature).
2. Hypothesis written: *what* inefficiency, *why* it might exist, *when* it should fail.
3. Target regimes stated in advance.
4. Required data listed and checked for availability and point-in-time correctness. 5–10. Entry, exit, stop, target, holding-time and position-sizing rules written as a declarative spec (YAML/JSON validated by schema), not prose.
5. Strategy version created (immutable; any edit = new version). 12–13. Backtest with the standard cost model (fees, spread, slippage).
6. Final test on a held-out period opened once.
7. Robustness: parameter neighbourhood, other asset, other period, cost stress.
8. Paper trading.
9. Comparison against the current champion for the same slot.
10. Recommendation: APPROVE / REJECT / MORE\_RESEARCH, recorded with evidence.

**Discovery budget.** Every hypothesis tested counts toward a multiple-testing tally (Part F). This makes "try 500 ideas and keep the best" visibly expensive, which is the main defence against data-mined strategies.

**Strategy spec example (abridged):**

```yaml
strategy_id: trend_pullback_swing
version: 0.1.0
hypothesis: "In confirmed up-trends, pullbacks to EMA50 on 4h resolve upward more often than chance after costs"
regimes: [TRENDING_UP]
symbols: [BTC/USDT, ETH/USDT]
timeframe: 4h
context: { timeframe: 1d, rule: "close > ema200" }
entry: { all: ["ema20 > ema50", "low <= ema50 * 1.003", "close > open", "rsi14 between 40 and 60"] }
stop: { rule: "swing_low(10) - 0.2*atr14", min_atr: 1.5 }
target: { r_multiple: 2.5, trail: "swing_low(5)" }
time_stop: { bars: 30, unless_r_at_least: 1.0 }
sizing: { method: fixed_fractional_risk }
```

## Part F — Strategy testing

A strategy is approved for paper trading only when the *lower* confidence bound of its out-of-sample net expectancy is above zero, across walk-forward windows, with realistic costs, and after a penalty for how many variants were tried.

**Data split (chronological, never shuffled)**

| Segment | Share of history | Use |
| --- | --- | --- |
| Development | \~60% | Rule design, parameter search |
| Validation | \~20% | Choose between finalists; walk-forward folds |
| Test (sealed) | \~20%, most recent | Opened once per strategy version; a second look = new version + new sealed period |
| Paper trading | Live, forward | The only truly unseen data |

**Walk-forward.** Rolling windows (e.g. 12 months train → 3 months test, step 3 months) over the full history. Report every fold, not the average alone; a strategy that earns all its profit in one fold fails.

**Backtest engine rules (prevent the classic errors)**

- Signals use only closed candles; orders fill no earlier than the next bar's open (or simulated limit-order queue).
- Indicator warm-up bars are discarded; features computed point-in-time.
- Intrabar ambiguity: when stop and target are both inside one bar, assume the **stop** hit first unless 1m data proves otherwise.
- Costs: exchange fee tier (maker and taker), half-spread, and slippage modelled as a function of volatility and order size; then stress at 1.5× and 2× cost.
- Exchange filters (min notional, step size, tick size) applied as in live.
- No survivorship issue for BTC/ETH, but delisted-pair logic is kept for future markets.

**Metrics reported for every run:** net profit, net return, trades, win/loss rate, average win/loss, expectancy (R and %), profit factor, max drawdown, Sharpe, Sortino, Calmar, exposure-adjusted return, average holding time, trade frequency, fees and slippage paid, per-regime breakdown, per-asset breakdown, per-fold breakdown, MFE/MAE distributions, parameter-sensitivity map.

**Statistical controls**

- Bootstrap (block bootstrap of trade sequences) for 95% confidence intervals on expectancy and max drawdown.
- Multiple-testing: track the number of variants tried per hypothesis family; apply Deflated Sharpe Ratio or a Bonferroni/Holm-style adjustment to the required bound. More variants tried = higher bar.
- Parameter stability: performance must hold in a neighbourhood (e.g. ±20% on each parameter); a sharp peak is overfitting.
- Cross-asset: a BTC-designed strategy should at least not collapse on ETH.

**Default promotion thresholds (configurable, owner-approved):**

| Gate | Requirement |
| --- | --- |
| Sample | ≥ 100 out-of-sample trades (swing may need longer history; until then: MORE\_DATA) |
| Edge | 95% lower bound of net expectancy > 0 at 1.0× costs; point estimate > 0 at 1.5× costs |
| Robustness | ≥ 70% of walk-forward folds profitable; parameter neighbourhood profitable |
| Risk | Max drawdown (bootstrap 95th pct) ≤ configured strategy limit |
| Paper | ≥ 30 days and ≥ 50 trades (scalp) or ≥ 90 days and ≥ 30 trades (swing); paper expectancy within the backtest confidence band |
| Approval | Human sign-off recorded in `promotion_decisions` |

High historical profit alone never passes a gate; it is usually the first sign of overfitting.

## Part G — Strategy selection

Selection is a two-stage filter-then-score process; if nothing clears the filter, the answer is NO\_TRADE.

**Stage 1 — hard eligibility (all must pass, deterministic):**

- Strategy status is APPROVED for this mode (paper or live) and health is HEALTHY or WATCH.
- Current regime is in the strategy's declared regimes, and Market Intelligence uncertainty is below the strategy's tolerance. UNKNOWN regime → only strategies explicitly validated for UNKNOWN (initially none).
- Data quality flag is OK for every timeframe the strategy reads.
- No active circuit breaker affecting this symbol or strategy.
- Regime-conditional sample ≥ 30 trades with lower-bound expectancy > 0 in this regime (otherwise eligible only at reduced risk if configured, or not at all).

**Stage 2 — score (quantitative, explainable):**

```text
score = shrunk_expectancy_in_regime          # Bayesian shrinkage toward 0 by sample size
      − λ_unc  × uncertainty                  # width of the confidence interval
      − λ_cost × expected_cost_R              # current spread/fees vs typical
      − λ_dd   × current_drawdown_vs_limit
      − λ_corr × correlation_with_open_exposure
      × health_multiplier                     # 1.0 HEALTHY, 0.5 WATCH
```

Recent performance enters only through the shrunk estimate and health, never as raw recent win rate. λ weights are configuration, chosen by backtest of the selector itself and versioned like a strategy.

**Outputs:** one strategy; several compatible strategies (different timeframes, low correlation); a strategy at reduced risk; or `NO_TRADE` with reasons (e.g. "regime RANGING; no approved range strategy", "data stale on 1h").

**When the system must not trade:** regime UNKNOWN/UNCERTAIN; data quality degraded; spread or volatility outside every strategy's limits; a scheduled high-impact event inside the strategy's blackout window; any circuit breaker active; all candidate scores ≤ 0.

**Conflict handling (Trading Supervisor).** Signals are grouped by symbol. Rules, in order: (1) a CLOSE\_LONG from the strategy that owns the position is honoured; (2) a CLOSE\_LONG from a different strategy on a different horizon is advisory, routed to Exit Intelligence, not executed directly; (3) OPEN\_LONG signals from correlated strategies on the same symbol merge into one position, not stacked, unless allocation allows; (4) material conflict between technical signals and news → WAIT or reject unless a validated strategy defines the case; (5) when unsure, choose the lower-risk action.

## Part H — Strategy allocation

Recommended method: **risk-budget allocation with uncertainty-shrunk weights and hard caps**, upgraded to constrained optimisation only after the system has enough live data to estimate correlations reliably.

**Why not full mean-variance optimisation now.** With 2 symbols, 4 strategies and few live trades, expected-return and correlation estimates are noisy. Optimisers amplify estimation error and produce extreme, unstable weights. A simple, capped rule is more robust until each strategy has hundreds of trades.

**MVP allocation (deterministic):**

1. Start from the account's total risk budget R\_total (e.g. max 3% of equity open-at-risk).
2. For each eligible strategy i, raw weight w\_i = max(0, shrunk expectancy\_i) / max(ε, σ\_i), where σ\_i is the standard deviation of its R outcomes.
3. Multiply by health (1.0 / 0.5) and by a drawdown throttle: 1.0 below half the strategy's drawdown limit, linearly to 0.25 at the limit.
4. Normalise to sum ≤ 1, then apply caps: per-strategy risk ≤ 1.5% of equity; per-symbol ≤ 2%; correlated cluster (e.g. all BTC long strategies) ≤ 2%.
5. Per-trade risk = strategy budget ÷ its max concurrent positions, then capped by `max_risk_per_trade`.
6. The Risk Manager re-checks everything; Allocation's numbers are requests, not permissions.

**Phase 6 upgrade — constrained optimisation:**

```latex
\max_{w} \; w^{\top}\hat{\mu} - \gamma \, w^{\top}\hat{\Sigma} w \quad \text{s.t.} \; w_i \ge 0,\; \sum_i w_i \le W_{max},\; w_i \le w_{i,max},\; \text{cluster}_k(w) \le c_k
```

with μ̂ shrunk toward zero (James–Stein style) and Σ̂ shrunk toward a diagonal (Ledoit–Wolf). Solved with a small QP solver (e.g. cvxpy/OSQP). Adopted only if, in walk-forward, it beats the MVP rule on risk-adjusted return without breaching caps.

**What Allocation never does:** raise risk after losses; exceed any hard limit; allocate to a paused or unhealthy strategy; treat a short-term streak as a reason to concentrate.

## Part I — Entry timing intelligence

Entry Timing turns a valid signal into a good fill, or refuses it; a correct direction with a bad entry is still a bad trade.

**Checks run in order (first failure decides):**

| # | Check | Fails → |
| --- | --- | --- |
| 1 | Signal still inside its validity window (`expiresAt`) and its candle closed | NO\_TRADE (expired) |
| 2 | Signal timeframe candle not yet closed but strategy needs a close | WAIT\_FOR\_CANDLE\_CLOSE |
| 3 | Spread ≤ strategy max; book depth at top levels ≥ 5× order size | REJECT\_ENTRY (cost/liquidity) |
| 4 | Price chase: distance from signal reference price ≤ 0.25 × ATR (scalp) / 0.5 × ATR (swing) | WAIT\_FOR\_PULLBACK (if still valid) else REJECT\_ENTRY |
| 5 | Net reward-to-risk at current price after costs ≥ strategy minimum | WAIT\_FOR\_PULLBACK or REJECT\_ENTRY |
| 6 | Nearest resistance not closer than 1R above entry | REJECT\_ENTRY |
| 7 | Breakout strategy: close beyond level + volume confirmation | WAIT\_FOR\_BREAKOUT\_CONFIRMATION |
| 8 | Higher-timeframe agreement as the strategy spec requires | NO\_TRADE |
| — | All pass | ENTER\_NOW |

**WAIT states are bounded.** Each wait carries a deadline (e.g. 3 bars) and a price condition; on expiry the proposal becomes EXPIRED and is journalled for counterfactual review (Part N).

**Validated improvement path.** A learned entry-quality model (probability of reaching +1R before −1R given entry context) may later replace fixed thresholds in checks 4–6, but only after it passes Part F as a challenger and its probabilities are calibrated (reliability curve, Brier score). A directional prediction alone is never enough to enter.

## Part J — Trade duration intelligence

Duration Intelligence gives each trade a holding *plan* (expected range, hard maximum, time-based invalidation), estimated from history, never an exact close time.

**Estimation method.** For each strategy × regime × volatility bucket, use historical trades to fit a time-to-event model (Kaplan–Meier survival curves with competing risks: target hit, stop hit, time exit). From it:

- Expected holding range = 25th–75th percentile of time-to-target among winners.
- Maximum permitted holding time = 90th percentile of winners' time-to-target (rounded to bars), capped by the strategy spec.
- Time-invalidation rule = "if not at ≥ X R after T bars, exit": the T and X that historically separated eventual winners from losers, validated out of sample.

**Broad horizons (for orientation only):** scalping seconds–minutes to \~2h; intraday minutes–hours; swing hours–days; position days–weeks. Oliskey's four starters sit in scalp (5m bars) and swing (4h bars).

**Live monitoring.** Each bar, Duration publishes: elapsed vs expected range; progress in R vs the historical path of winners at the same elapsed time; flag `SLOW` (behind the winner path) or `STALE` (past max). Exit Intelligence turns these into HOLD / TIME\_EXIT. Continued holding past the expected range is justified only by explicit spec conditions (e.g. trailing stop already locks profit and trend strength intact).

**Event awareness.** A scheduled high-impact event inside the remaining holding window raises the flag `EVENT_RISK`; the spec decides whether to tighten the stop, take partial profit or hold.

## Part K — Exit intelligence

Exits follow a strict precedence: Risk Manager mandatory exits first, then the strategy's own explicit rules, then validated exit models; an unvalidated prediction can only *tighten* protection, never cause a close by itself.

**Exit actions and triggers**

| Action | Typical trigger (from strategy spec or validated model) |
| --- | --- |
| HOLD | Hypothesis intact, inside expected duration, no rule triggered |
| PROTECT | Price reached +1R → stop to break-even plus costs; or trailing rule advances |
| PARTIAL\_EXIT | Spec-defined partial target reached (e.g. 50% at 1.2R) |
| CLOSE | Final target hit, or trailing stop hit |
| INVALIDATE | The condition that justified entry is gone (e.g. 4h close below EMA50 for a pullback-to-EMA50 trade; regime flips to TRENDING\_DOWN) |
| TIME\_EXIT | Duration flags STALE, or SLOW plus spec's time-invalidation rule |

**Stops are server-held and exchange-held.** On spot, place a real stop order on the exchange where the venue supports it (e.g. STOP\_LOSS\_LIMIT or OCO), and also monitor in software. If a venue lacks native stops, software stop with a fail-safe: if the monitor misses heartbeats, a circuit breaker fires (Part L).

**Measured exit quality (per strategy, rolling):** average holding time; time-to-target; time-to-stop; MFE and MAE distributions; capture ratio = realised profit ÷ MFE; give-back = MFE − realised; exit slippage; share of TIME\_EXITs; share of trades open past invalidation; share open through high-risk events.

**Judging exits without hindsight.** "Too early" or "too late" is judged against the *rule set as it stood at the time* and against alternative rules tested on the whole sample, never against the best possible exit in one trade. A proposed exit change (e.g. trail at 1.5 × ATR instead of swing lows) must improve expectancy across the sample, not just recover a few memorable trades.

## Part L — Risk management

The Risk Manager is plain, deterministic, separately deployed code with its own database permissions; it is the only component that can turn a proposal into an approved order, and nothing can bypass it.

**Configurable limits (initial illustrative values, owner sets real ones):**

| Limit | Illustrative default | Scope |
| --- | --- | --- |
| Max risk per trade | 1.0% of equity (0.5% while live is new) | Per trade |
| Max total open risk | 3.0% | Account |
| Max daily loss | 3.0% of start-of-day equity (realised + unrealised − costs) | Account, resets 00:00 UTC |
| Max drawdown from peak | 10% → kill switch | Account |
| Max portfolio exposure (notional) | 60% of equity | Account |
| Max open positions | 4 | Account |
| Max strategy risk | 1.5% | Strategy |
| Max correlated exposure | 2.0% risk across BTC+ETH longs | Cluster |
| Max trading frequency | e.g. 20 orders/hour, 60/day | Account |
| Min net R:R after costs | per strategy spec | Trade |

**Position sizing (long spot).**

```text
risk_amount      = equity × min(strategy_trade_risk, max_risk_per_trade)
entry_eff        = entry_price × (1 + expected_slippage + taker_fee)
stop_eff         = stop_price  × (1 − stop_slippage_buffer − taker_fee)
risk_per_unit    = entry_eff − stop_eff                    # must be > 0, else REJECT
qty_raw          = risk_amount ÷ risk_per_unit
qty              = floor_to_step(min(qty_raw,
                       available_quote × (1 − fee_buffer) ÷ entry_eff,
                       exposure_headroom ÷ entry_eff), step_size)
reject if qty × entry_price < min_notional or qty < min_qty
actual_risk      = qty × risk_per_unit                     # recomputed from final qty
reject if actual_risk > risk_amount                        # rounding can never add risk
```

**Validation checks on every proposal:** stop below entry and target above entry (long); stop distance ≥ min ticks and ≤ strategy max; price/qty rounded to exchange tick/step; balance sufficient after fees; daily loss + this trade's risk ≤ daily limit; open risk, exposure, positions, correlation and frequency inside limits; symbol trading status OK; proposal not expired; idempotency key unused.

**Kill switch.** A row in `risk_state` (persistent, not in memory), checked by Risk before every approval and by the Order Manager before every send. Set by: drawdown breach, daily-loss breach, operator, or circuit breakers marked critical. Effects: no new orders; optional flatten per config. Cleared only by an authenticated human action with a reason, logged in `audit_log`. A timer never clears it.

**Mandatory exits.** Risk can order CLOSE on any position (e.g. drawdown breach with flatten-on-kill configured); Exit and Execution must obey.

## Part M — Execution intelligence

Execution chooses *how* to fill an approved order at the lowest expected cost within the approval's limits; any change to quantity, stop or risk goes back to the Risk Manager.

**Order-type decision**

| Situation | Choice |
| --- | --- |
| Swing entry, spread normal, no urgency | Post-only limit at best bid (maker); reprice up to N times within a limit band; cancel at signal expiry |
| Scalp entry, signal decays fast | Limit at ask (marketable limit, capped price) rather than raw market order |
| Stop or mandatory exit | Marketable limit with wide cap, or market if the venue's book is deep; speed over cost |
| Spread > strategy max or expected slippage pushes net R:R below minimum | REJECT\_EXECUTION (journalled) |
| Book thin relative to size | Slice into child orders, or reject |

**Order lifecycle (state machine):** `NEW → SUBMITTED → (PARTIALLY_FILLED)* → FILLED | CANCELED | REJECTED | EXPIRED`. Each transition is persisted before and after the exchange call.

**Reliability rules**

- **Idempotency:** each order gets a deterministic `clientOrderId` derived from the decision id; retries reuse it, so a timeout can never create a duplicate.
- **Retries:** only on safe errors (network, 5xx, rate limit) with exponential backoff and jitter; after a timeout, query order status by `clientOrderId` before retrying.
- **Partial fills:** position and protective stop are sized to the *filled* quantity at every fill; unfilled remainder is cancelled at expiry.
- **Reconciliation:** every minute and after every error, compare exchange balances, open orders and fills with the local ledger; any mismatch → circuit breaker `RECONCILE_FAIL`.
- **Rate limits:** a token bucket per venue, read from the exchange's own limits.
- **Venue differences:** an adapter interface (`placeOrder`, `cancel`, `getOrder`, `getBalances`, `getFilters`, `streamFills`) with per-venue capability flags (supports OCO, stop-limit, post-only). Never assume identical behaviour.

**Paper trading uses the same code path** with a `PaperExchangeAdapter` that fills against live order-book snapshots, charges the real fee schedule and applies queue/slippage models, so paper results are comparable to live. Execution quality is measured as implementation shortfall: fill price vs decision-time mid price, in basis points.

## Part N — Individual agent learning

Every agent improves the same way: it measures itself against its own success metric, writes hypotheses about its weaknesses, and submits candidate versions to the champion–challenger process; it never edits its live self.

**Each agent's own success metric (examples)**

| Agent | Measured by |
| --- | --- |
| Market Intelligence | Does regime label predict which strategy family performs? (regime-conditional expectancy spread; label stability) |
| Strategy Selection | Expectancy of selected vs not-selected eligible strategies; NO\_TRADE counterfactual cost |
| Entry Timing | Entry price vs signal reference; expectancy of ENTER\_NOW vs WAIT outcomes; missed-trade cost |
| Trade Duration | Calibration of holding ranges; TIME\_EXIT trades' counterfactual outcome |
| Exit Intelligence | Capture ratio, give-back, expectancy vs baseline exit rule |
| Risk | Zero limit breaches; drawdown vs forecast |
| Execution | Implementation shortfall, fill rate, rejection rate |
| Discovery / Testing | Share of approved strategies whose live results stay inside their test confidence band |

**Performance Learning — decision quality vs outcome.** Each closed trade gets two independent grades:

- *Decision quality* (rule-based): rules followed? data fresh? entry inside validity window? risk within limits? exit by rule? → GOOD / FLAWED with reason codes.
- *Outcome*: net P&L, R multiple, target/stop/time exit, MFE, MAE, duration vs plan.

A good decision with a loss is variance; a flawed decision with a win is luck to be fixed. Only patterns across ≥ 30 similar trades become hypotheses.

**Counterfactual review of rejected signals.** Rejected and expired proposals are simulated forward with the *rules that would have applied at decision time* (same stop, target, time stop), never with knowledge of what happened next. The result estimates the cost of each rejection reason; a reason that blocks profitable trades over a large sample becomes an improvement hypothesis.

**Agent registry record:** agent ID, name, responsibility, current version, previous versions (immutable configs), improvement history, open hypotheses, evidence links, known weaknesses, discoveries shared/received, adoption status, measured performance impact, dependencies, compatibility requirements. Versions are append-only; rollback = re-pointing "current" to an earlier version.

Your existing `learning.py` already does a version of this (root-cause tags, `should_adopt` with halves-consistency checks, adopt-only-if-proven). It becomes the Performance Learning core, generalised from InZone/Fixed Time to spot trades.

## Part O — Collaborative intelligence

Collaboration is a structured, auditable improvement pipeline, not agents chatting: agents exchange typed messages through an event table, every improvement carries its evidence, and each receiving agent tests it in its own context before adopting anything.

**Message types (one schema, `type` discriminates)**

| Type | Sent by → to | Purpose |
| --- | --- | --- |
| ResearchFinding | Any agent → Collab AI | An observation with evidence, not yet a proposal |
| StrategyWeaknessReport | Learning / Recovery → strategy owner, Collab AI | A measured weakness with reason codes |
| ImprovementProposal | Source agent → Collab AI | A candidate change with hypothesis and test plan |
| ImprovementReport | Source agent → Collab AI → knowledge base | Full results of a tested change (§22 fields) |
| CompatibilityAssessment | Receiving agent → Collab AI | Relevant? needs adaptation? risks? |
| ImprovementAdoptionRequest | Collab AI → receiving agents | "Evaluate this for your context" |
| ImprovementTestResult | Receiving agent → Collab AI | Its own test, its own metrics |
| ImprovementConflictReport | Collab AI → owners, human | Two changes pull in opposite directions |
| ImprovementApproval / ImprovementRejection | Promotion Gate (+ human) → all | Final decision with reasons |
| PerformanceUpdate | Monitoring → Collab AI | Post-deployment impact vs expectation |

**Required fields on every message:** message\_id, type, source\_agent, source\_agent\_version, destinations, created\_at, improvement\_id, context (symbol, timeframe, strategy, regime), description, evidence (links to experiment runs, never pasted numbers), limitations, required\_action, validation\_status, schema\_version.

**Lifecycle states:** IDEA → HYPOTHESIS → PROPOSED → TESTING → VALIDATED → PAPER\_TRADING → APPROVED → DEPLOYED, with REJECTED and RETIRED as exits. Transitions are enforced by the database (a check on allowed from→to pairs), so an idea can never be labelled DEPLOYED without passing the stages between.

**Explanation grades.** Every improvement states which it has: *plausible* (reasoned only) → *experimentally supported* (backtest evidence) → *validated* (passed Part F gates) → *deployed* (live, monitored). The dashboard shows the grade; an LLM's fluent explanation never upgrades it.

**Cross-agent flow (example from your prompt).** Trend strategy finds a trend-confirmation feature that cuts false entries in moderate volatility → Collab AI matches the feature's tags against the agent registry → sends AdoptionRequests to Market Intelligence, both scalp strategies, both swing strategies, Entry Timing and Exit → each replies with a CompatibilityAssessment (accept for testing / adapt / reject / need evidence / collaborate / save for later) → those that accept run their own tests on their own timeframes and metrics → Risk receives a notice only if any adoption changes exposure patterns → results return as TestResults; each adoption is promoted separately.

**Conflict resolution.** When improvements conflict (enter earlier vs wait for confirmation vs early entries add risk): Collab AI files a ConflictReport, defines a joint experiment that tests each change alone and in combination on the same data, scoped by regime and timeframe, and picks by expectancy lower bound and drawdown. Until resolved, the current champion behaviour stays; if still uncertain, the lower-activity option wins.

**Champion–challenger for agents and strategies.** Challengers run in shadow mode (compute decisions on live data, no orders), then paper, then a capped live allocation (e.g. 10% of the champion's risk budget). Promotion needs pre-registered criteria (Part F thresholds plus "challenger beats champion on the lower bound, not just the mean") and human approval. Rollback is one action: point back to the previous version.

**Shared knowledge base.** Postgres tables (hypotheses, experiments, findings, strategy/agent profiles, incidents) are the source of truth: structured, versioned, auditable. A vector index over the text fields is added only as a search aid, never as the record.

**Measuring whether collaboration works:** proposals, tested, adopted, rejected; success rate; performance and risk impact of adopted changes (vs pre-registered expectation); cross-agent adoption rate; duplicate research caught; time idea→validated and validated→deployed; regressions and rollbacks. Success = system expectancy and reliability up, not more proposals.

## Part P — Strategy recovery

Recovery is rule-driven first (automatic risk reduction and pause by predefined thresholds), research-driven second (diagnose, propose a new version, test it), and human-approved last (restore).

**Health states and default triggers**

| State | Trigger (any) | Automatic action |
| --- | --- | --- |
| HEALTHY | Live expectancy inside backtest confidence band | None |
| WATCH | Rolling 30-trade expectancy below band's lower edge; drawdown > 50% of strategy limit; cost/trade > 1.5× tested; trade frequency outside ±50% of expected | Risk × 0.5; alert |
| PAUSED | Drawdown ≥ strategy limit; CUSUM/Page-Hinkley change detection on R series fires; regime suitability lost for > N days; data or execution faults attributed to it | No new entries; open trades managed by Exit/Risk |
| RETIRED | Paused > 90 days with no recovery candidate passing tests | Archived with full history |

**Recovery procedure (the 10 steps):** identify the problem (which metric, since when) → record evidence (`strategy_health_events`) → reduce risk or pause per the table → diagnose (regime shift? cost increase? data issue? decay of edge?) using Performance Learning's tags → compare with alternative strategies in the same regime → propose changes as an ImprovementProposal → create a new strategy version → full Part F testing including the period that caused the failure → paper trading → recommend restore; human approves.

**Restoring the old version** (no changes) is allowed when the diagnosis is "regime temporarily unsuitable" and the regime returns, but it re-enters at WATCH with half risk until 30 new trades confirm. Nothing about a live strategy is ever rewritten in place.

## Part Q — Complete architecture

One modular monorepo, three runtime processes and one database: the live loop is a typed, deterministic pipeline; the learning and research loop runs beside it and can only change live behaviour by producing a new approved version through the Promotion Gate.

&#91;embedded content: system architecture · live loop + learning loop\]

Read it as a snake: data flows top row left to right, then down through selection and timing to the Risk Manager (the only gate to orders), out to the exchange, back through exit management into the journal, and finally into the learning and research loop. Exit orders (CLOSE, PARTIAL\_EXIT) re-enter at the Risk Manager like any other order.

**Runtime layout**

| Process | Language | Owns | Talks to |
| --- | --- | --- | --- |
| `backend` (API + live loop + Risk + OMS) | Node/TypeScript | Users, keys, orders, positions, risk state, kill switch | Postgres (service role), exchange, `intel` (private HTTP) |
| `intel` (research + models) | Python/FastAPI | Features, regime model, backtests, experiments, duration models | Postgres (read market data, write research tables only) |
| `agents` (LLM workers, Phase 5+) | Python or TS | Discovery, Learning write-ups, Collaboration routing | Postgres research tables, `intel` experiments API; **no** access to order tables or exchange keys |
| `app` | Expo/React Native Web | Dashboard | `backend` API + WebSocket |

**Permission boundaries** are enforced with separate Postgres roles: only `backend` can write `orders`, `positions`, `risk_state`; `agents` can only insert into `agent_messages`, `improvement_*`, `research_hypotheses`, `knowledge_entries`. This is how "no agent can bypass Risk" becomes a database fact, not a promise.

**Monorepo layout (proposed additions to your repo)**

```text
oliskey-alpha/
  app/                    # existing Expo app (+ AI Spot screens)
  backend/                # existing Express → TypeScript modules
    src/spot/marketdata/  src/spot/supervisor/  src/spot/risk/
    src/spot/execution/   src/spot/oms/         src/spot/adapters/{binance,paper}/
  intel/                  # existing Python engine
    engine/spot/{features,regime,strategies,backtest,duration,health}.py
  agents/                 # Phase 5: LLM research and collaboration workers
  packages/contracts/     # JSON Schema → Zod + Pydantic
  supabase/migrations/    # new 0xx_spot_*.sql migrations
```

**Fault tolerance:** each loop step is idempotent and persists its output before the next step reads it, so a crash resumes from the last saved step; protective stops live on the exchange, so a backend outage does not leave positions unprotected; any unreachable dependency on the order path fails closed (NO\_TRADE).

## Part R — Technical stack

Keep your existing split: TypeScript/Node owns money, orders and users; Python owns research and models; Postgres is the single source of truth. Add only what solves a named problem.

| Layer | Recommendation | Why | Status in your repo |
| --- | --- | --- | --- |
| Monorepo | npm workspaces (`app`, `backend`, `intel`) + a `packages/contracts` workspace | Shared schemas without microservice overhead | Workspaces exist; add `contracts` |
| Order path, API, Risk, OMS, exchange adapters | Node 22 + TypeScript (migrate backend from ESM JS module by module) | Types on the money path; Zod at boundaries | Express ESM JS today |
| Contracts | JSON Schema as the source, generated to Zod (TS) and Pydantic (Python) | One definition, two languages, no drift | New |
| Research, backtests, ML, regime detection | Python (keep your pinned versions) + FastAPI internal API, pandas/numpy, LightGBM, scikit-learn (calibration), statsmodels (change detection) | Already working and tested | Exists (`intel/`) |
| Orchestration of agent steps | Plain typed pipeline in Node for the live loop; **LangGraph only for the LLM research agents** (Discovery, Learning write-ups, Collab routing) after an evaluation in Phase 2 | The live loop must be deterministic and fast; graphs help with multi-step LLM research | Evaluate |
| Database | Supabase Postgres + RLS (users isolated) | Already in place; transactional money functions | Exists |
| Time series | Start in Postgres (partitioned `candles` table); TimescaleDB only if bar volume or query speed demands it | 2 symbols × few timeframes is small; avoid a second database early | Bars already stored by intel |
| Analytics | DuckDB over Parquet exports for heavy backtest analysis | Fast local columnar queries, zero ops | New, optional |
| Cache / pub-sub | Redis only when you run more than one backend instance; until then Postgres LISTEN/NOTIFY + in-process | Fewer moving parts | Not needed yet |
| Exchange access | CCXT for market data and as a reference; hand-written adapter for the live venue's order endpoints | CCXT normalises data; orders need exact venue semantics | Binance feed exists |
| LLM | Your existing Google Generative AI integration, behind a provider interface | Swap-able; LLM never on the order path | Exists (`ai.js`) |
| Observability | OpenTelemetry traces (decision id = trace id), Prometheus metrics, Grafana dashboards, Sentry errors | Every decision traceable end to end | New |
| CI/CD | GitHub Actions: lint, type-check, unit + property tests, DB money-rule tests, replay test on a fixed dataset | Prevent regressions on the money path | CI exists |
| Hosting | Backend + intel on an always-on host (Railway/Fly/VPS), not a home PC | Your notes show the PC sleeping stopped trading for \~75 min | Railway config exists |
| Frontend | Keep Expo Router app; add Next.js only if a separate web console is needed | One UI codebase | Exists |

Pin versions from what is current at build time and record them in lockfiles; the spec does not fix versions.

## Part S — Database design

Thirty-five tables; ids are UUIDs unless noted, every table has `created_at`, user-owned tables carry `user_id` with RLS, and anything that drives decisions is versioned and append-only.

| Table | Purpose | Key columns | Relations / keys | Indexes | Retention / versioning |
| --- | --- | --- | --- | --- | --- |
| `users` | Supabase auth profile | id, role, kyc\_state | PK id | — | Life of account |
| `user_trading_configs` | Per-user risk + mode | user\_id, mode (paper/live), risk limits JSON, active\_strategy\_ids, version | FK users | (user\_id, version) | Versioned; old rows kept |
| `exchange_accounts` | Venue link | user\_id, venue, key\_ref (secret-manager id, never the key), permissions | FK users | (user\_id, venue) | Keys rotated, never stored raw |
| `strategies` | Strategy identity | id, slot (e.g. swing\_strict), family, owner\_agent\_id | PK | slot | Permanent |
| `strategy_versions` | Immutable spec | strategy\_id, semver, spec JSON, spec\_hash, status (lifecycle), parent\_version\_id | FK strategies | (strategy\_id, status) | Never deleted |
| `agents` | Agent identity | id, name, responsibility, kind (D/Q/L/X) | PK | — | Permanent |
| `agent_versions` | Immutable agent config/model | agent\_id, version, config JSON, model\_artifact\_uri, status | FK agents | (agent\_id, status) | Never deleted |
| `agent_performance` | Agent metric snapshots | agent\_version\_id, metric, window, value, ci\_low, ci\_high | FK agent\_versions | (agent\_version\_id, metric, as\_of) | 2 years, then monthly rollup |
| `candles` | OHLCV | symbol, timeframe, open\_time, o/h/l/c/v, source, is\_final | PK (symbol, timeframe, open\_time) | partition by month | Raw forever (small); 1m kept 2 years |
| `data_quality_events` | Gaps, duplicates, stale feeds | symbol, timeframe, kind, from, to, resolved | — | (symbol, kind, from) | 2 years |
| `features` | Indicator/feature values point-in-time | symbol, timeframe, open\_time, feature\_set\_version, values JSONB | PK (symbol, timeframe, open\_time, feature\_set\_version) | partition by month | Recomputable; 1 year |
| `market_regimes` | MarketState snapshots | symbol, timeframe, as\_of, regime, trend\_dir, trend\_strength, vol\_pct, uncertainty, evidence JSON, agent\_version\_id | FK agent\_versions | (symbol, as\_of) | 2 years |
| `signals` | Raw strategy signals | strategy\_version\_id, symbol, tf, candle\_close\_at, action, ref\_price, stop, target, expires\_at, evidence | FK strategy\_versions | (symbol, created\_at) | 2 years |
| `trade_proposals` | Supervisor output (§T) | proposal\_id, signal\_ids\[\], contract fields, schema\_version | FK signals | (status, created\_at) | Permanent (audit) |
| `trading_decisions` | Audit of every stage | proposal\_id, supervisor/entry/risk/execution decisions + reasons, final\_status, risk\_config\_version, order\_id | FK trade\_proposals | (final\_status, created\_at) | Permanent |
| `orders` | Exchange orders | decision\_id, client\_order\_id (unique), venue\_order\_id, side, type, price, qty, status, mode | FK trading\_decisions | unique client\_order\_id; (status) | Permanent |
| `fills` | Executions | order\_id, price, qty, fee, fee\_asset, ts | FK orders | (order\_id) | Permanent |
| `positions` | Open/closed positions | user\_id, symbol, strategy\_version\_id, qty, avg\_entry, stop, target, state | FK users, strategy\_versions | (user\_id, state) | Permanent |
| `trades` | Round trips | position\_id, entry/exit, net\_pnl, r\_multiple, fees, slippage\_bps, mfe, mae, duration, exit\_reason, decision\_grade | FK positions | (strategy\_version\_id, closed\_at) | Permanent |
| `risk_state` | Kill switch + limits in force | scope (account/strategy), kill\_switch, reason, set\_by, set\_at | — | unique scope | Every change → audit\_log |
| `risk_events` | Rejections and breaches | decision\_id, rule, value, limit | FK trading\_decisions | (rule, created\_at) | Permanent |
| `circuit_breaker_events` | Trips and recoveries | kind, severity, scope, opened\_at, closed\_at, closed\_by, notes | — | (kind, opened\_at) | Permanent |
| `research_hypotheses` | Ideas | author\_agent\_id, family, text, regimes, status | FK agents | (status) | Permanent |
| `experiments` | Any test run | hypothesis\_id, subject (strategy/agent version), kind (backtest/walk-forward/paper/shadow), dataset\_ref, params, variants\_tried | FK hypotheses | (subject, kind) | Permanent |
| `backtest_runs` | Backtest detail | experiment\_id, period, cost\_model, metrics JSON, trades\_uri | FK experiments | (experiment\_id) | Metrics permanent; trade files 2 years |
| `paper_runs` | Paper trading windows | experiment\_id, start, end, metrics JSON | FK experiments | — | Permanent |
| `improvement_proposals` | Proposals and lifecycle | improvement\_id, source\_agent\_version\_id, title, status, explanation\_grade | FK agent\_versions | (status) | Permanent |
| `improvement_reports` | §22 report | improvement\_id, all report fields, metrics from experiment ids | FK proposals, experiments | (improvement\_id) | Permanent |
| `agent_messages` | Typed messages (Part O) | message\_id, type, source/destinations, payload JSONB, schema\_version | FK proposals | (type, created\_at), (improvement\_id) | Permanent |
| `improvement_adoptions` | Per-receiving-agent evaluation | improvement\_id, agent\_id, decision, test\_experiment\_id, outcome | FK proposals, agents | (improvement\_id, agent\_id) unique | Permanent |
| `knowledge_entries` | Shared knowledge | kind (research/strategy/agent/operational), subject\_ref, body, evidence\_refs, version, supersedes\_id | self FK | (kind, subject\_ref); full-text GIN | Versioned, append-only |
| `strategy_health` | Health snapshots + transitions | strategy\_version\_id, state, metrics JSON, trigger | FK strategy\_versions | (strategy\_version\_id, as\_of) | Permanent |
| `performance_metrics` | Rolled-up metrics | subject, scope (regime/asset/window), metric, value, ci | — | (subject, metric, as\_of) | Permanent |
| `promotion_decisions` | Gate outcomes | subject version, from\_stage, to\_stage, criteria results, approver | FK versions | (subject) | Permanent |
| `audit_log` | Every privileged action | actor (user/agent/service), action, target, before/after hash, ts | — | (target, ts) | Permanent, insert-only (no UPDATE/DELETE grants) |

**Integrity rules enforced in SQL (as your current money functions do):** lifecycle transitions via check functions; `orders.client_order_id` unique; positions and balances changed only through security-definer functions called with the service role; `audit_log` insert-only; live-mode inserts refused unless `platform_settings.live_trading_enabled` and the user's live flag are both true.

## Part T — Data contracts

Every hand-off between components is a versioned, schema-validated record; a message that fails validation is rejected and logged, never "best-effort" parsed.

**The three distinct objects on the money path:** `Signal` (a strategy's opinion) → `TradeProposal` (Supervisor's merged, timed intent) → `ApprovedOrder` (Risk's sized permission). Only an `ApprovedOrder` can reach the Order Manager.

```ts
// packages/contracts — generated from JSON Schema; Zod shown
const Action = z.enum(["OPEN_LONG", "CLOSE_LONG", "HOLD"]);   // spot: no OPEN_SHORT exists

const MarketState = z.object({
  schemaVersion: z.literal("1.0"),
  symbol: z.enum(["BTC/USDT", "ETH/USDT"]), timeframe: z.string(), asOf: z.string().datetime(),
  regime: z.enum(["TRENDING_UP","TRENDING_DOWN","RANGING","BREAKOUT","REVERSAL_RISK","TRANSITIONAL","UNKNOWN"]),
  trendDirection: z.enum(["UP","DOWN","FLAT","UNKNOWN"]), trendStrength: z.number().min(0).max(100),
  volatilityPercentile: z.number().min(0).max(100), momentum: z.enum(["RISING","FALLING","NEUTRAL"]),
  levels: z.array(z.object({ kind: z.enum(["SUPPORT","RESISTANCE"]), price: z.number(), strength: z.number() })),
  uncertainty: z.number().min(0).max(1), recommended: z.array(z.string()), avoid: z.array(z.string()),
  evidence: z.array(z.string()), dataQuality: z.enum(["OK","DEGRADED","FAILED"]), agentVersion: z.string(),
});

const TradeProposal = z.object({
  schemaVersion: z.literal("1.0"), proposalId: z.string().uuid(), agentId: z.string(),
  strategyId: z.string(), strategyVersion: z.string(), symbol: z.string(), timeframe: z.string(),
  action: Action, createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
  candleCloseAt: z.string().datetime(), dataSource: z.string(),
  entryPrice: z.number().positive(), stopLoss: z.number().positive(), takeProfit: z.number().positive(),
  confidence: z.object({ value: z.number().min(0).max(1), calibrated: z.boolean() }), // uncalibrated = score, not probability
  marketRegime: MarketState.shape.regime, expectedNetRewardRisk: z.number(),
  holdingPlan: z.object({ expectedMinBars: z.number(), expectedMaxBars: z.number(), maxBars: z.number() }),
  reasoningSummary: z.string().max(500), supportingEvidence: z.array(z.string()),
  invalidationConditions: z.array(z.string()),
}).refine(p => p.action !== "OPEN_LONG" || (p.stopLoss < p.entryPrice && p.takeProfit > p.entryPrice),
          "long: stop < entry < target")
  .refine(p => Date.parse(p.expiresAt) > Date.parse(p.createdAt));

const TradingDecision = z.object({
  decisionId: z.string().uuid(), proposalId: z.string().uuid(),
  supervisor: z.object({ status: z.enum(["ACCEPTED","REJECTED","DEFERRED"]), reasons: z.array(z.string()) }),
  entryTiming: z.enum(["ENTER_NOW","WAIT_FOR_PULLBACK","WAIT_FOR_BREAKOUT_CONFIRMATION","WAIT_FOR_CANDLE_CLOSE","REJECT_ENTRY","NO_TRADE"]),
  risk: z.object({ status: z.enum(["APPROVED","REJECTED"]), qty: z.number().optional(),
                   actualRisk: z.number().optional(), rulesFailed: z.array(z.string()), riskConfigVersion: z.string() }),
  execution: z.object({ status: z.enum(["PENDING","EXECUTED","REJECTED","EXPIRED"]), orderId: z.string().optional() }).optional(),
  finalStatus: z.enum(["ACCEPTED","REJECTED","DEFERRED","APPROVED","EXECUTED","EXPIRED","PENDING"]),
  timestamps: z.record(z.string().datetime()), strategyVersion: z.string(),
});
```

The same pattern defines `Signal`, `ApprovedOrder`, `ExitDecision` (HOLD/PROTECT/PARTIAL\_EXIT/CLOSE/INVALIDATE/TIME\_EXIT), `HoldingPlan`, `StrategySpec`, `AgentMessage` (Part O) and `ImprovementReport` (all §22 fields, metrics as references to `experiments` rows, never typed numbers).

**Validation and versioning rules**

- JSON Schema files are the source; CI generates Zod and Pydantic and fails if generated code is stale.
- Every record carries `schemaVersion`. Additive changes = minor version; removing or changing meaning of a field = major version, with both versions accepted during a migration window.
- Validate at every boundary (Python → Node, Node → DB, LLM output → system). LLM output is parsed with strict schema (structured output), then passed through the same deterministic checks as any other input.
- Spot safety: `Action` has no short-opening member; the Order Manager maps CLOSE\_LONG to a sell of at most the held quantity, so a sell can never open a short.

**Internal APIs (backend ↔ intel, private network only):** `GET /intel/market-state/:symbol`, `POST /intel/signals/evaluate`, `POST /intel/experiments` (async; returns run id), `GET /intel/experiments/:id`, `POST /intel/duration-plan`. User APIs follow the existing `/api` pattern with auth and rate limits.

## Part U — Testing

No real-money trading until all six test layers pass in CI and a readiness checklist is signed. The money path (sizing, risk, orders, settlement) gets the strictest coverage; your repo already tests money rules in SQL and should keep that habit.

| Layer | What it covers | Examples of must-pass cases |
| --- | --- | --- |
| Unit | Indicators, strategy rules, sizing, risk rules, exit logic, selection scoring, improvement evaluation | EMA/RSI/ATR/ADX match a reference implementation to 1e-9; each strategy rule fires on a hand-built candle set |
| Property-based (fast-check in TS, Hypothesis in Python) | Invariants over random inputs | Approved risk ≤ permitted risk for any price/stop/fee/step; stop ≥ entry always rejected for longs; qty is a multiple of step and ≥ min notional or rejected; CLOSE\_LONG never sells more than held |
| Integration | Exchange adapter (testnet/sandbox), order lifecycle, risk verification, reconciliation, DB persistence, agent messaging, knowledge writes, adoption flow | Partial fill → stop resized; timeout → status query → no duplicate order; kill switch set mid-flow blocks the send |
| Replay | Historical data through the whole live pipeline | Same inputs → byte-identical decisions (determinism); replayed decisions match the backtest engine's trades for the same strategy version |
| Fault injection | Network loss, stale data, exchange rejects, partial fills, duplicate events, DB down, Risk service down, message-bus failure | Risk unreachable → no orders (fail closed); stale candle → NO\_TRADE + breaker; duplicate fill event → idempotent |
| Paper trading | Strategy performance, cost and slippage assumptions, order handling, risk enforcement, recovery, collaborative improvements | Paper slippage within ±50% of model; zero risk-limit breaches; a deliberately degraded strategy is paused by health rules |

**Live-readiness checklist (all required):** Phases 1–4 complete; ≥ 1 strategy passed Part F and its paper gate; 30 consecutive days of paper with zero unexplained reconciliation mismatches; kill switch and every circuit breaker drilled; API keys trade-only, IP-allowlisted, no withdrawal; backups restored in a drill; monitoring alerts tested; the legal sign-off your `CLAUDE.md` requires for real money; owner approval recorded.

## Part V — Monitoring

Monitoring watches four things — money, models, machinery and data — and every alert names its owner action; an alert nobody can act on is removed.

| Area | Metrics | Alert (examples) | Action |
| --- | --- | --- | --- |
| Risk & P&L | Equity, daily P&L vs limit, drawdown vs limit, open risk, exposure, positions | Daily loss ≥ 70% of limit (warn), 100% (critical) | Warn: notify; critical: breaker + kill switch |
| Strategy health | Rolling expectancy vs band, profit factor, trade frequency, cost/trade, change-detection stat | Strategy enters WATCH or PAUSED | Notify; Recovery workflow opens |
| Model health | Regime label distribution drift, feature drift (PSI), calibration error of any probability model | PSI > 0.25 on a key feature; calibration error doubles | Freeze model at current version; open investigation |
| Execution | Implementation shortfall (bps), fill rate, reject rate, order latency p95, rate-limit headroom | Shortfall > 2× model for 20 orders; reject rate > 5% | Breaker on venue; review |
| Data | Last candle age per symbol/TF, gaps, duplicates, feed disconnects, price divergence across sources | Candle age > 1.5 × timeframe; cross-source divergence > 0.5% | Data breaker → NO\_TRADE for affected symbol |
| System | Process up, heartbeat of each loop, DB latency, queue depth, error rate (Sentry) | Missed heartbeat 2× | Page owner; protective stops are already on the exchange |
| Reconciliation | Local vs exchange balances/orders/positions | Any mismatch | Critical breaker; human review |
| Research | Experiments running, variants tried per family, proposals by status | Variants tried in a family > budget | Block further runs until reviewed |

**Circuit breakers** (independent of strategies) by category: data failure (temporary; auto-retry data, trading resumes only after a human or a defined N-bar clean-data check *and* reconciliation pass), exchange failure, strategy failure, risk-limit breach, operational failure, market emergency (e.g. 1-minute move > X × normal). On trip: block new orders → cancel eligible open entry orders → reconcile → record incident → notify → evaluate open positions by rule → controlled recovery. **No breaker ever auto-resets on a timer.**

**Notification channels:** in-app (existing push), email, and WhatsApp/Telegram for critical alerts to the owner. Every alert links to the decision trace (OpenTelemetry trace id = decision id).

## Part W — User dashboard

The dashboard answers three questions in order — am I safe, what is the system doing, and why — and never hides risk to look simpler. It extends the existing Oliskey Alpha app (Expo, pure-black palette, mascot) with an **AI Spot** area.

| Screen | Shows | User can |
| --- | --- | --- |
| Overview | Equity, realised/unrealised P&L, open risk vs limit (meter), daily-loss meter, drawdown meter, kill-switch and breaker status, paper/live badge | Pause all trading (sets kill switch), switch paper/live (if eligible) |
| Market | Current regime per symbol with plain-English evidence ("Trending up: 4h above EMA50, ADX 31, volatility 42nd percentile"), recommended and avoided strategy types | — |
| Strategies | Each strategy: status (paper/approved/paused), health state, suitability now, regime fit, live vs tested expectancy with confidence band, drawdown, trades | Activate/deactivate, read the strategy's plain-English explanation and version history |
| Positions | Entry, current price, stop, target, R now, expected holding range vs elapsed (progress bar), exit plan, P&L | Close manually (still passes Risk/Execution) |
| Decisions | Every proposal with outcome: accepted/rejected/expired and the exact reason at each stage | Filter by strategy/reason; open the full decision trace |
| History | Closed trades with net P&L, fees, slippage, R, MFE/MAE, decision grade | Export CSV |
| Risk settings | Limits within platform caps, chosen from presets (Conservative / Standard) with consequences explained | Lower any limit at once; raising takes effect next UTC day |
| Research & improvements | Improvement timeline with explanation grade (plausible → deployed), adopted/rejected, measured impact; strategy pauses and recoveries | Read reports |

**Copy rules:** say "estimated" and "historical" where true; show sample size beside every percentage; label uncalibrated scores as "signal strength", not "probability"; show "Paper — no real money" prominently in paper mode; keep the existing "can lose" disclaimers.

## Part X — Implementation roadmap

Phases follow your prompt's order, but each ends at an evidence gate rather than a date, and real money comes only after all six gates and the readiness checklist.

&#91;embedded content: implementation roadmap · 6 phases, 6 gates\]

**One adjustment recommended:** the Risk Manager core, kill switch and paper adapter move into Phase 1, and basic circuit breakers into Phase 2, rather than waiting for Phase 4. Nothing should generate signals, even on paper, before the component that limits them exists.

**Milestones inside Phase 1 (first build):**

- [ ] Extend `intel` data refresh to BTC/USDT and ETH/USDT spot at 5m, 1h, 4h, 1d with data-quality events
- [ ] Create `packages/contracts` with Signal, TradeProposal, ApprovedOrder, TradingDecision
- [ ] Migrations for strategies, versions, signals, proposals, decisions, orders, fills, positions, trades, risk\_state, audit\_log
- [ ] Risk Manager + kill switch with property tests
- [ ] Paper exchange adapter and Order Manager with idempotent client order ids
- [ ] Backtest engine: spot cost model, intrabar rule, walk-forward, bootstrap, variants tally
- [ ] First run of the four starter strategies; publish results honestly, including failures

Dates are left out on purpose: each phase's length depends on how fast evidence accumulates, especially for swing strategies that trade rarely.

## Part Y — Additional ideas

Most of these are features of existing components rather than new agents; priority 1 = build with the core, 3 = after live evidence exists.

| Feature | Purpose | Required data | How it works | Benefit | Risk | Depends on | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Strategy Health Monitor | Detect decay early | Trades, costs, frequency | Rolling bands + CUSUM change detection (Part P) | Stops losses compounding | False alarms pause good strategies | Trade journal | 1 |
| Decision Replay Engine | Reconstruct any decision exactly | Versioned data, configs, decisions | Re-run pipeline at a timestamp with pinned versions | Debugging, trust, audits | Storage cost | Versioning, determinism | 1 |
| Data Quality Intelligence | Stop bad data from trading | Candles, multi-source prices | Gap/duplicate/staleness/divergence checks per bar | Avoids phantom signals | Over-strict checks block trading | Ingestion | 1 |
| Execution Quality Monitor | Know if costs eat the edge | Fills, book snapshots | Implementation shortfall by strategy and hour | Shows when scalping is uneconomic | Needs enough fills | Execution | 2 |
| Counterfactual Trade Evaluator | Price the cost of each rejection rule | Rejected/expired proposals | Forward-simulate with decision-time rules only | Tunes filters on evidence | Hindsight creep if done wrongly | Journal, replay | 2 |
| Market Regime Transition Monitor | Catch regime changes | Regime series, features | Hidden-Markov / change-point probability of a switch | Earlier de-risking | Noisy switches | Market Intelligence | 2 |
| Strategy Comparison Lab | Fair head-to-head tests | Same data, same costs | Runs champions and challengers on identical folds | Cleaner promotions | None notable | Testing | 2 |
| Strategy Retirement & Recovery | Lifecycle hygiene | Health history | State machine of Part P | Keeps roster lean | Losing a strategy that would recover | Health Monitor | 2 |
| Adaptive Risk Budget | Scale risk to evidence | Expectancy CI, drawdown | Allocation multiplier bounded by validated range | More risk only where earned | Hidden leverage of luck | Allocation, Health | 3 |
| Strategy Intelligence Graph | See what works where | Strategies, regimes, features, results | Graph view over knowledge tables (Postgres, later a graph DB only if needed) | Faster research, less duplication | Becomes decoration if unused | Knowledge base | 3 |
| Research Agent | Generate and run hypotheses | Knowledge base, budgets | LLM proposes, code tests within a variants budget | More ideas tested safely | Data-mining if budget ignored | Testing, multiple-testing tally | 3 |
| Collaborative Improvement Network | Share validated improvements | Messages, registry | Part O | Compounding learning | Coordination overhead | Everything above | 3 |
| Pre-mortem on promotion (new) | Force a written failure scenario before each promotion | Strategy spec | Required field: "how this fails and what we'd see first" feeds Health thresholds | Faster detection of known failure modes | Paperwork | Promotion Gate | 1 |
| Cost-aware no-trade zones (new) | Avoid hours/venues where costs spike | Spread/slippage by hour | Block entries when expected cost > X R | Cheap, direct gain for scalping | Missed good trades | Execution monitor | 2 |

## Part Z — Risks and limitations

The largest risk is not a software bug; it is believing a measured edge is real when it is noise. Most of this design exists to make that mistake expensive and visible.

| Risk | What it looks like | Mitigation in this design | What remains uncertain |
| --- | --- | --- | --- |
| Market uncertainty | Edges decay, regimes shift, crypto crashes overnight | Regime gating, health monitor, drawdown limits, NO\_TRADE | A real edge may not exist for long-only BTC/ETH at retail costs |
| Model uncertainty | Confident outputs that are wrong; uncalibrated scores read as probabilities | Calibration requirement, confidence intervals, shrinkage | Calibration itself drifts |
| Overfitting | Great backtest, flat or negative live | Sealed test set, walk-forward, multiple-testing penalty, paper gate | Cannot be eliminated, only reduced |
| Small samples | Swing strategies produce few trades; verdicts take months | MORE\_DATA verdict; pooling evidence across assets cautiously | Swing approval may take 6–12 months of evidence |
| Data quality | Gaps, bad ticks, wrong timestamps, look-ahead | Data breakers, point-in-time features, multi-source checks | Exchange-level outages |
| Execution risk | Slippage, partial fills, stop not honoured in a gap | Exchange-held stops, shortfall monitoring, cost-aware entries | Spot stops can still fill far below in flash crashes |
| Operational risk | Host sleeps, keys leak, double orders, DB failure | Hosted always-on services, trade-only keys, idempotency, reconciliation, backups | Third-party (exchange, cloud) failures |
| Counterparty / venue | Exchange insolvency, freezes, regulatory action | Keep only trading capital on venue; plan for multiple venues | Not controllable |
| Regulatory | Offering automated trading to Nigerian users may need licensing | Real-money gate + legal sign-off already in your rules | Rules for AI trading services are evolving |
| Collaborative learning risk | Agents reinforce each other's errors; a bad improvement spreads; feedback loops | Each adopter tests independently; lifecycle gates; rollback; regression tracking | Correlated errors across agents sharing features |
| LLM-specific | Persuasive but wrong explanations; prompt injection via news text | LLMs off the order path; explanation grades; news treated as data, never instructions | Quality varies by model and version |
| Human risk | Overriding limits after losses; promoting too early | Raising limits takes effect next day; promotions need recorded criteria | Discipline cannot be fully coded |

Your own live numbers illustrate the point: 251 AI trades on demo is encouraging but, as your notes already say, not yet proof. The spot system starts from zero evidence and must earn it the same way.

## Part AA — Final recommendations

Build the measuring and protecting machinery first and the clever agents last: a system that can prove whether one simple strategy works after costs is worth more than thirteen agents that cannot.

**Build first, in this order, and why**

1. **Data layer + data-quality checks** for BTC/ETH (reuse `intel/engine/data.py`, extend to 5m/1h/4h/1d). Everything downstream is only as good as this.
2. **Contracts package** (Signal, TradeProposal, ApprovedOrder, TradingDecision). Locks the boundaries before code multiplies.
3. **Deterministic Risk Manager + kill switch + Order Manager with paper adapter**, fully property-tested. This is what protects money; it must exist before any strategy trades even on paper.
4. **Backtest engine upgrade** (spot costs, intrabar rule, exchange filters, walk-forward, bootstrap, variants tally) — extend your existing `backtest.py`, which already has Wilson and expectancy lower bounds.
5. **The four starter strategies as specs**, tested; expect some to fail. Swing likely first to pass, scalping last.
6. **Market Intelligence (regime)** as a rules-plus-percentile model, validated by whether it separates strategy performance.
7. **Trade journal, decision trace, health monitor, dashboard Overview/Decisions.** You need to see and replay before you learn.
8. Then Performance Learning → Recovery → Champion–Challenger → Collaborative layer → Discovery/Research agents → allocation optimiser and news/sentiment.

**Assumptions made**

- One exchange to start (Binance-family API, since your feed already uses it); final venue choice depends on Nigerian access and legal advice.
- Single owner account first; multi-user (other people's money) is out of scope until licensed.
- Python intel stays a separate process on a private network; Node backend remains the only service with exchange keys.
- Fees modelled at 0.1% per side taker unless the venue's tier says otherwise.

**Unresolved decisions for you**

- [ ] Exchange venue for paper data and eventual live trading
- [ ] Real values for risk limits (per trade, daily, drawdown) and whether the kill switch flattens positions
- [ ] Hosting target for always-on backend + intel (Railway config exists; confirm)
- [ ] Whether AI Spot lives inside Oliskey Alpha or ships as a separate app
- [ ] Human approver(s) for promotions besides you
- [ ] LLM provider for research agents (current: Google Generative AI)

**Next step:** once you settle the venue and risk limits, the first build task is steps 1–3 above as one milestone, with the property tests for sizing written before the sizing code.

## Sources

- [Oliskey Alpha repository](https://github.com/Oliskey/oliskey-alpha) — v0.0.21: `CLAUDE.md`, `AI-PROGRESS.md`, `AI-NUMBERS.md`, `intel/` engine, `backend/`, `supabase/migrations/`
- [Oliskey Alpha live app](https://alpha.oliskey.com/)
- Oliskey AI Trading master prompt (attached), sections 1–42
