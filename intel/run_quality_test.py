"""Do fewer, stronger trades earn more? The owner's goal is profit, not more trades. Uses the finished test trades saved by run_wide_contest.py, so it
needs no training. Writes docs/intel/quality.json. It reports only: raising a bar is a separate decision.

RULE, FIXED 2026-11-07 BEFORE ANY RESULT OF THESE TRADES WAS SEEN, the same as the earlier sit-out rule and not to be loosened. A higher bar replaces today's only if ALL hold:
  1. total profit at a fixed stake is at least as high as today's bar;
  2. profit divided by the worst losing run is at least 20% better;
  3. total profit is at least as high in at least 2 of the 3 periods;
  4. the average per trade is higher, and at least 500 trades remain.
Dropping weaker trades only filters what was taken: a coin freed by a skipped trade taking a later one is not counted, so this slightly understates a higher bar.
Usage: python intel/run_quality_test.py"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_crypto_lab as lab                     # noqa: E402
from engine.settings import ROOT                 # noqa: E402

READINGS = lab.CACHE / "readings"
BARS = {"inzone": (0.4862, 0.50, 0.52, 0.54, 0.56, 0.58), "fixed_time": (0.5656, 0.58, 0.60, 0.62)}


def measure(t: pd.DataFrame, periods: list) -> dict:
    if t.empty:
        return {"trades": 0, "won": 0.0, "avg": 0.0, "total": 0.0, "worst_run": 0.0, "ratio": 0.0, "periods": [0.0 for _ in periods]}
    s = t.sort_values("t")
    curve = s["r"].cumsum()
    run = float((curve.cummax().clip(lower=0) - curve).max())
    total = float(s["r"].sum())
    return {"trades": len(s), "won": float(s["win"].mean()), "avg": float(s["r"].mean()), "total": total, "worst_run": run, "ratio": total / run if run > 0 else 0.0,
            "periods": [float(s.loc[s["period"] == p, "r"].sum()) for p in periods]}


def passes(r: dict, base: dict) -> bool:
    return (r["total"] >= base["total"] and r["ratio"] >= base["ratio"] * 1.2 and r["trades"] >= 500 and r["avg"] > base["avg"]
            and sum(a >= b for a, b in zip(r["periods"], base["periods"])) >= 2)


def main() -> None:
    out = {"generated_at": datetime.now(timezone.utc).isoformat(), "kinds": {}}
    for kind, bars in BARS.items():
        path = READINGS / f"{kind}.pkl"
        if not path.exists():
            continue
        t = pd.read_pickle(path)
        periods = sorted(t["period"].unique())
        rows = {b: measure(t[t["conf"] > b], periods) for b in bars}
        base = rows[bars[0]]
        chosen = [b for b in bars[1:] if passes(rows[b], base)]
        out["kinds"][kind] = {"today": bars[0], "passing": chosen, "bars": {str(b): r for b, r in rows.items()}}
        print(kind, "passes:", chosen or "none", flush=True)
        for b, r in rows.items():
            print(f"  bar {b:.4f}: {r['trades']:6} trades, won {r['won']:.2%}, avg {r['avg']:+.4f}, total {r['total']:+8.1f}, worst run {r['worst_run']:6.1f}, profit/run {r['ratio']:6.2f}", flush=True)
    (ROOT / "docs" / "intel" / "quality.json").write_text(json.dumps(out, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
