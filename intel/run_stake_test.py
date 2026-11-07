"""Does staking more on stronger readings earn more than one stake on everything? Uses the finished test trades saved by run_wide_contest.py, so it needs no
training. Writes docs/intel/stakes.json. It reports only: changing what a user's money does is the owner's decision.

Both ways use the same average stake, so neither is simply betting more.
RULE, FIXED 2026-11-07 BEFORE ANY RESULT WAS SEEN, not to be loosened. Staking by strength passes only if ALL hold:
  1. total profit is at least as high as the flat stake;
  2. profit divided by the worst losing run is at least 20% better;
  3. total profit is at least as high in at least 2 of the 3 periods;
  4. the worst day is no worse than 10% beyond the flat stake's.
Tiers, set before looking, in multiples of the smallest stake: InZone below 52% is 1, below 56% is 2, otherwise 3. Fixed Time below 58% is 1, below 60% is 2, otherwise 3.
Usage: python intel/run_stake_test.py"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_crypto_lab as lab                     # noqa: E402
from engine.settings import ROOT                 # noqa: E402

READINGS = lab.CACHE / "readings"
TIERS = {"inzone": (0.52, 0.56), "fixed_time": (0.58, 0.60)}


def stakes(conf: pd.Series, low: float, high: float) -> np.ndarray:
    raw = np.where(conf < low, 1.0, np.where(conf < high, 2.0, 3.0))
    return raw / raw.mean()      # the same average stake as a flat 1


def measure(t: pd.DataFrame, stake: np.ndarray, periods: list) -> dict:
    s = t.assign(money=t["r"].to_numpy() * stake).sort_values("t")
    curve = s["money"].cumsum()
    run = float((curve.cummax().clip(lower=0) - curve).max())
    total = float(s["money"].sum())
    return {"total": total, "worst_run": run, "ratio": total / run if run > 0 else 0.0, "worst_day": float(s.groupby(s["t"].dt.floor("D"))["money"].sum().min()),
            "periods": [float(s.loc[s["period"] == p, "money"].sum()) for p in periods]}


def passes(r: dict, flat: dict) -> bool:
    return (r["total"] >= flat["total"] and r["ratio"] >= flat["ratio"] * 1.2 and sum(a >= b for a, b in zip(r["periods"], flat["periods"])) >= 2
            and r["worst_day"] >= flat["worst_day"] - abs(flat["worst_day"]) * 0.1)


def main() -> None:
    out = {"generated_at": datetime.now(timezone.utc).isoformat(), "kinds": {}}
    for kind, (low, high) in TIERS.items():
        path = READINGS / f"{kind}.pkl"
        if not path.exists():
            continue
        t = pd.read_pickle(path)
        periods = sorted(t["period"].unique())
        flat = measure(t, np.ones(len(t)), periods)
        tiered = measure(t, stakes(t["conf"], low, high), periods)
        ok = passes(tiered, flat)
        out["kinds"][kind] = {"flat": flat, "by_strength": tiered, "passes": ok}
        for name, r in (("flat", flat), ("by strength", tiered)):
            print(f"{kind} {name:12} total {r['total']:+8.1f}, worst run {r['worst_run']:6.1f}, profit/run {r['ratio']:6.2f}, worst day {r['worst_day']:6.1f}, by period {[round(a, 1) for a in r['periods']]}", flush=True)
        print(f"{kind} passes:", ok, flush=True)
    (ROOT / "docs" / "intel" / "stakes.json").write_text(json.dumps(out, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
