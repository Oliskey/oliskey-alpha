# The four AI Trading strategies — rules fixed before any result (2026-11-12)

Code: `backend/src/trading/strategyRunner.js` · tests: `backend/test/trading-strategy-runner.test.mjs`.
These rules are written before any AI Trading result exists and are not changed after seeing results. A change means a new
version number, created as `testing`, and it trades only after an admin approves it with evidence.

## What drives them
The 14 AI Spot agents (`intel/engine/spot/agents.py`) decide on every closed bar of BTC/USDT and ETH/USDT and store each decision,
frozen, in `intel.spot_agent_decisions`. The lab registry (`docs/intel/spot_registry.json`) says which lab strategies are
`APPROVED_FOR_PAPER`, on which coin or on the unseen-coins basket. The four AI Trading strategies only follow those decisions;
they add no prediction of their own.

| Strategy | Follows | Lab approval it needs |
|---|---|---|
| Strict Scalping | 15-minute decisions | the chosen lab strategy approved for paper **on that exact coin** |
| Balanced Scalping | 15-minute decisions | approved on the coin, or through the basket that includes it |
| Strict Swing | 4-hour decisions | approved on that exact coin |
| Balanced Swing | 4-hour decisions | approved on the coin or through the basket |

## When a buy signal is written
All of these, or the decision is recorded as `skip`, `wait` or `veto` with the reason:
1. The agents decided **TRADE** (every agent needed agreed, none blocked) within the last **10 minutes**.
2. The lab approval above holds.
3. The agents' exit plan has an entry and a stop.
4. A **fresh real price**: Binance's public spot price, at most **30 seconds** old. Never a simulated or old price.
5. That price is at most **0.5% above** the planned entry and above the stop.

## When a sell signal is written
When the agents' own paper trade for that buy closes (`intel.spot_paper_trades`: stop, target, trailing stop, break-even or time
exit), one sell signal is written at a fresh real price. Holdings bought from that signal are sold. Long-only: never short.

## Who gets orders
Only allocations on **testnet** connections, through `placeStrategyOrder`, so every order passes the risk engine
(`backend/src/trading/risk.js`): pauses, emergency stop, approved strategy version, active subscription, fresh price, slippage,
size and loss limits, duplicates. Live connections are never traded by the runner (REAL-MONEY GATE in `CLAUDE.md`).
Today every version is `testing` and no subscription can be bought, so the risk engine refuses the orders and records why;
that is the intended state until the owner approves a version for paper with evidence.

## Records
- every strategy decision, taken or not: `trading.agent_decisions` (agent `ai_spot_agents`, with the agents' decision id)
- every signal: `trading.trading_signals` (reference price and its time, stop, target, the agents' order id)
- every order attempt and refusal: `trading.risk_events`, `trading.trading_orders`
- switch the runner off: `TRADING_STRATEGY_RUNNER=off`
