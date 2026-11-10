"""AI Spot batch 3: the frozen candidates on coins they never saw (pre-registered in docs/intel/SPOT_HYPOTHESES.md).

Usage:  python intel/fetch_spot_history.py --unseen   (once)
        python intel/run_spot_unseen.py

Writes docs/intel/SPOT_UNSEEN.md and docs/intel/spot_unseen.json. A strategy that passes is marked
APPROVED_FOR_PAPER in docs/intel/spot_registry.json (symbol "BASKET"). Nothing here touches real money.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine.spot import backtest as bt                       # noqa: E402
from engine.spot.data import UNSEEN, load, validate          # noqa: E402
from engine.spot.strategies import BY_ID, prepare            # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs" / "intel"
CANDIDATES = ("trend_breakout", "squeeze_breakout")


def main() -> int:
    for sym in UNSEEN:
        for tf in ("4h", "1d"):
            q = validate(load(sym, tf), sym, tf)
            if not q.ok:
                print("data quality failed; nothing tested:", sym, tf, q.problems)
                return 1
    results = {}
    for sid in CANDIDATES:
        spec = BY_ID[sid]
        by_symbol = {}
        for sym in UNSEEN:
            f = prepare(load(sym, "4h"), load(sym, "1d"), spec)
            by_symbol[sym] = (bt.run(f, spec, 1.0), bt.run(f, spec, 1.5), bt.run(f, spec, 2.0))
        r = bt.pooled(by_symbol, n_tests=len(CANDIDATES))
        r["spec"] = spec.as_dict()
        results[sid] = r
        m = r["metrics_1x"]
        print(f"{sid:17} trades={m.get('trades', 0):4} E={m.get('expectancy_r', 0):+.3f}R "
              f"low={r.get('confidence', {}).get('expectancy_low', float('nan')):+.3f} verdict={r['verdict']}")
        for k, ok in r.get("checks", {}).items():
            print(f"   {'PASS' if ok else 'FAIL'} {k}")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    (DOCS / "spot_unseen.json").write_text(json.dumps({"generated_at": now, "coins": list(UNSEEN), "results": results},
                                                      indent=2, default=str))
    # Register the basket verdicts next to the lab's, so the backend obeys them.
    reg_path = DOCS / "spot_registry.json"
    reg = json.loads(reg_path.read_text())
    reg["strategies"] = [s for s in reg["strategies"] if s["symbol"] != "BASKET"]
    for sid, r in results.items():
        reg["strategies"].append({"strategy_id": sid, "version": r["spec"]["version"], "symbol": "BASKET",
                                  "coins": list(UNSEEN), "timeframe": "4h", "verdict": r["verdict"],
                                  "expectancy_r": r["metrics_1x"].get("expectancy_r"), "trades": r["metrics_1x"].get("trades"),
                                  "expectancy_low": r.get("confidence", {}).get("expectancy_low"),
                                  "checks": r.get("checks", {}), "test": "batch 3, unseen coins"})
    text = json.dumps(reg, indent=2, default=str)
    reg_path.write_text(text)
    (ROOT / "intel" / "models").mkdir(parents=True, exist_ok=True)
    (ROOT / "intel" / "models" / "spot_registry.json").write_text(text)

    L = ["# AI Spot batch 3: frozen candidates on unseen coins", "",
         f"Generated {now}. Pre-registered in `docs/intel/SPOT_HYPOTHESES.md` (batch 3) before this run. "
         f"Coins never used for any AI Spot strategy before: {', '.join(s.replace('USDT', '') for s in UNSEEN)}. "
         "Settings frozen; costs 0.12% per side, re-run at 1.5x and 2x; 4h signals, 1d context.", ""]
    for sid, r in results.items():
        m, c = r["metrics_1x"], r.get("confidence", {})
        L += [f"## {sid} 0.1.0 — **{r['verdict']}**", ""]
        if m.get("trades"):
            L += [f"{m['trades']} trades · win {m['win_rate']:.1%} · expectancy {m['expectancy_r']:+.3f}R "
                  f"(lower bound {c.get('expectancy_low', float('nan')):+.3f}R) · profit factor {m['profit_factor']:.2f} · "
                  f"at 1.5x costs {r['metrics_1_5x'].get('expectancy_r', 0):+.3f}R · at 2x {r['metrics_2x'].get('expectancy_r', 0):+.3f}R · "
                  f"bootstrap 95th-pct drawdown {c.get('max_dd_p95_pct', float('nan')):.1f}%", ""]
        L += [f"- {'PASS' if ok else 'FAIL'}: {k}" for k, ok in r.get("checks", {}).items()] + [""]
        L += ["| Coin | Trades | Expectancy R |", "| --- | ---: | ---: |"]
        L += [f"| {s.replace('USDT', '')} | {v['trades']} | {'' if v['expectancy_r'] is None else f'{v['expectancy_r']:+.3f}'} |"
              for s, v in r["per_symbol"].items()]
        L += ["", "| Window | Trades | Expectancy R |", "| --- | ---: | ---: |"]
        L += [f"| {x['from']} to {x['to']} | {x['trades']} | {'' if x['expectancy_r'] is None else f'{x['expectancy_r']:+.3f}'} |"
              for x in r["folds"]]
        L.append("")
    (DOCS / "SPOT_UNSEEN.md").write_text("\n".join(L) + "\n")
    print("Report: docs/intel/SPOT_UNSEEN.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
