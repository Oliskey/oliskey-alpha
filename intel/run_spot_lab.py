"""AI Spot lab: test the four starter strategies on real BTC/USDT and ETH/USDT spot history.

Usage:  python intel/fetch_spot_history.py   (once, or to refresh)
        python intel/run_spot_lab.py

Writes docs/intel/SPOT_RESULTS.md (readable report), docs/intel/spot_registry.json (what the backend may use)
and intel/models/spot_registry.json (runtime copy). A strategy can only reach APPROVED_FOR_PAPER here.
Nothing in this file can approve real-money trading.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine.spot import backtest as bt                       # noqa: E402
from engine.spot.data import SYMBOLS, load, validate         # noqa: E402
from engine.spot.market import features, market_state        # noqa: E402
from engine.spot.strategies import SPECS, prepare            # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs" / "intel"
MODELS = ROOT / "intel" / "models"


def pct(x: float | None) -> str:
    return "–" if x is None else f"{x * 100:.1f}%"


def num(x: float | None, d: int = 3) -> str:
    return "–" if x is None else f"{x:+.{d}f}"


def main() -> int:
    n_tests = len(SPECS) * len(SYMBOLS)
    results, quality, states = [], [], {}
    for sym in SYMBOLS:
        for tf in ("15m", "1h", "4h", "1d"):
            quality.append(validate(load(sym, tf), sym, tf))
        states[sym] = market_state(sym.replace("USDT", "/USDT"), "4h", features(load(sym, "4h")))
    if not all(q.ok for q in quality):
        print("data quality failed; nothing tested", [q.problems for q in quality if not q.ok])
        return 1
    for spec in SPECS:
        for sym in SYMBOLS:
            f = prepare(load(sym, spec.timeframe), load(sym, spec.context_timeframe), spec)
            r = bt.evaluate(f, spec, n_tests)
            r["symbol"] = sym
            results.append(r)
            m = r["metrics_1x"]
            print(f"{spec.strategy_id:15} {sym}  trades={m.get('trades', 0):4}  E={m.get('expectancy_r', 0):+.3f}R  "
                  f"win={m.get('win_rate', 0):.1%}  verdict={r['verdict']}")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    registry = {"generated_at": now, "mode_allowed": "paper_only", "gates": bt.GATES.__dict__,
                "market_state": states,
                "strategies": [{"strategy_id": r["spec"]["strategy_id"], "version": r["spec"]["version"],
                                "symbol": r["symbol"], "timeframe": r["spec"]["timeframe"], "verdict": r["verdict"],
                                "expectancy_r": r["metrics_1x"].get("expectancy_r"),
                                "trades": r["metrics_1x"].get("trades"),
                                "expectancy_low": r.get("confidence", {}).get("expectancy_low"),
                                "checks": r.get("checks", {})} for r in results]}
    DOCS.mkdir(parents=True, exist_ok=True)
    MODELS.mkdir(parents=True, exist_ok=True)
    try:   # keep verdicts written by other tests (batch 3 basket); this script only owns the per-symbol rows
        old_rows = json.loads((DOCS / "spot_registry.json").read_text())["strategies"]
        registry["strategies"] += [s for s in old_rows if s.get("symbol") == "BASKET"]
    except (OSError, ValueError, KeyError):
        pass
    for p in (DOCS / "spot_registry.json", MODELS / "spot_registry.json"):
        p.write_text(json.dumps(registry, indent=2, default=str))

    approved = [r for r in results if r["verdict"] == "APPROVED_FOR_PAPER"]
    L = [f"# AI Spot: strategy test results", "",
         f"Generated {now}. Real Binance spot candles (BTC/USDT, ETH/USDT). Long-only, no leverage. "
         f"Costs: {SPECS[0].cost_per_side * 100:.2f}% per side (0.10% taker fee + 0.02% spread/slippage), "
         f"re-run at 1.5x and 2x. One position per strategy and symbol; 1% risk per trade for the equity curve.", "",
         f"**{len(approved)} of {len(results)} strategy/symbol pairs passed every gate** and may run on PAPER only. "
         "Nothing here permits real money. A pass is evidence, not a promise: paper trading must confirm it.", "",
         "Run log: the first run (2026-11-09) required swing entries to close above EMA20, which the spec does not say. "
         "That was a coding error, fixed once to match the spec (a bullish close above EMA50). Both runs: 0 of 8 passed. "
         "No parameter was tuned on results.", "",
         "## Gates (fixed before the first run, never loosened)", "",
         f"- At least {bt.GATES.min_trades} trades, else MORE_DATA",
         f"- Bootstrap lower bound of expectancy > 0 at {100 * (1 - bt.GATES.alpha / n_tests):.2f}% confidence "
         f"(Bonferroni over {n_tests} tests)",
         "- Expectancy still > 0 with costs x1.5",
         f"- At least {bt.GATES.min_fold_share:.0%} of 6 walk-forward windows profitable (windows with 10+ trades)",
         "- The sealed most-recent 20% of history is profitable",
         f"- Bootstrap 95th-percentile drawdown <= {bt.GATES.max_dd_p95_pct:.0f}% at 1% risk", "",
         "## Summary", "",
         "| Strategy | Symbol | TF | Trades | Win % | Avg win R | Avg loss R | Expectancy R | Lower bound R | "
         "Profit factor | Max DD | E at 1.5x | E at 2x | Sealed E | Verdict |",
         "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |"]
    for r in results:
        m, s = r["metrics_1x"], r["spec"]
        if not m.get("trades"):
            L.append(f"| {s['strategy_id']} | {r['symbol']} | {s['timeframe']} | 0 | | | | | | | | | | | {r['verdict']} |")
            continue
        L.append(f"| {s['strategy_id']} | {r['symbol']} | {s['timeframe']} | {m['trades']} | {pct(m['win_rate'])} | "
                 f"{m['avg_win_r']:.2f} | {m['avg_loss_r']:.2f} | {num(m['expectancy_r'])} | "
                 f"{num(r.get('confidence', {}).get('expectancy_low'))} | {m['profit_factor']:.2f} | "
                 f"{m['max_drawdown_pct']:.1f}% | {num(r['metrics_1_5x'].get('expectancy_r'))} | "
                 f"{num(r['metrics_2x'].get('expectancy_r'))} | {num(r['sealed_test'].get('expectancy_r'))} | "
                 f"**{r['verdict']}** |")
    L += ["", "## Detail per strategy", ""]
    for r in results:
        s, m = r["spec"], r["metrics_1x"]
        L += [f"### {s['strategy_id']} v{s['version']} on {r['symbol']} ({s['timeframe']}, context {s['context_timeframe']})",
              "", f"Hypothesis: {s['hypothesis']}", ""]
        if not m.get("trades"):
            L += ["No trades.", ""]
            continue
        L += [f"Sharpe {m['sharpe']:.2f} · Sortino {m['sortino']:.2f} · Calmar {m['calmar']:.2f} · "
              f"net return {m['net_return_pct']:+.1f}% · {m['trades_per_month']:.1f} trades/month · "
              f"avg hold {m['avg_bars_held']:.1f} bars · costs {m['avg_cost_r']:.3f}R per trade · "
              f"capture {m['capture_ratio']:.2f} · exits {m['exits']}", ""]
        if r.get("checks"):
            L += [f"- {'PASS' if ok else 'FAIL'}: {k}" for k, ok in r["checks"].items()] + [""]
        L += ["| Window | Trades | Expectancy R |", "| --- | ---: | ---: |"]
        L += [f"| {x['from']} to {x['to']} | {x['trades']} | {num(x['expectancy_r'])} |" for x in r["folds"]]
        if r["by_regime"]:
            L += ["", "| Regime at entry | Trades | Expectancy R |", "| --- | ---: | ---: |"]
            L += [f"| {k} | {v['count']:.0f} | {v['mean']:+.3f} |" for k, v in r["by_regime"].items()]
        L.append("")
    L += ["## Market state now (4h)", ""]
    for sym, st in states.items():
        L.append(f"- {sym}: **{st['regime']}**, direction {st['trendDirection']}, ADX {st['trendStrength']}, "
                 f"volatility percentile {st['volatilityPercentile']:.0f}, uncertainty {st['uncertainty']}")
    (DOCS / "SPOT_RESULTS.md").write_text("\n".join(L) + "\n")
    print(f"\n{len(approved)} of {len(results)} passed. Report: docs/intel/SPOT_RESULTS.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
