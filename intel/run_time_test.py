"""When should the AI sit out? Uses the finished test trades saved by run_wide_contest.py, so it needs no training and little memory.
Writes docs/intel/time.json. A window never becomes a sit-out by itself: the result is reported, and building one is a separate decision.

RULE, FIXED 2026-11-07 BEFORE ANY RESULT WAS SEEN, not to be loosened. A window of time passes only if ALL hold:
  1. chosen on the earlier periods alone: it loses money (average below zero) in each of them;
  2. luck allowed for: its average, with days as the unit of evidence, is below zero by more than the Bonferroni bar for every
     window tried across both trade types (one-sided 5% divided by the number tried);
  3. confirmed on the latest period, which played no part in choosing: it loses there too;
  4. at least 500 trades in the window;
  5. leaving it out raises total profit in every period.
Windows are in UTC. Sessions are the usual published ones, set before looking: Asia 00-07, Europe 07-13, London and New York together 13-17,
New York late 17-21, quiet 21-24. Funding hours are the hours starting at 00, 08 and 16 UTC.
Usage: python intel/run_time_test.py"""
from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from statistics import NormalDist

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_crypto_lab as lab                     # noqa: E402
from engine.settings import ROOT                 # noqa: E402

READINGS = lab.CACHE / "readings"
KINDS = ("inzone", "fixed_time")
SESSIONS = {"Asia": range(0, 7), "Europe": range(7, 13), "London and New York": range(13, 17), "New York late": range(17, 21), "quiet": range(21, 24)}
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def windows(t: pd.DataFrame) -> dict[str, pd.Series]:
    h, d = t["t"].dt.hour, t["t"].dt.dayofweek
    w = {f"hour {x:02d}": h == x for x in range(24)}
    w.update({DAYS[x]: d == x for x in range(7)})
    w.update({f"{n} session": h.isin(list(r)) for n, r in SESSIONS.items()})
    w["weekend"] = d >= 5
    w["funding hours"] = h.isin([0, 8, 16])
    w["Friday night into Saturday"] = ((d == 4) & (h >= 21)) | ((d == 5) & (h < 3))
    w["Sunday night into Monday"] = ((d == 6) & (h >= 21)) | ((d == 0) & (h < 3))
    return w


def day_z(s: pd.DataFrame) -> float:
    """Average over its standard error, each day counted once, because trades on one day move together."""
    if s.empty:
        return 0.0
    daily = s.groupby(s["t"].dt.floor("D"))["r"].sum()
    if len(daily) < 2 or daily.std() == 0:
        return 0.0
    return float(daily.mean() / (daily.std() / math.sqrt(len(daily))))


def passes(s: pd.DataFrame, periods: list, bar_z: float) -> bool:
    parts = [s[s["period"] == p] for p in periods]
    averages = [float(p["r"].mean()) if len(p) else 0.0 for p in parts]
    return (len(s) >= 500 and all(a < 0 for a in averages[:-1]) and day_z(pd.concat(parts[:-1])) < bar_z
            and averages[-1] < 0 and all(float(p["r"].sum()) < 0 for p in parts))


def main() -> None:
    frames = {k: pd.read_pickle(READINGS / f"{k}.pkl") for k in KINDS if (READINGS / f"{k}.pkl").exists()}
    if not frames:
        raise SystemExit("No saved test trades yet: run run_wide_contest.py first.")
    tried = sum(len(windows(f)) for f in frames.values())
    bar_z = NormalDist().inv_cdf(0.05 / tried)
    out = {"generated_at": datetime.now(timezone.utc).isoformat(), "windows_tried": tried, "bar_z": bar_z, "kinds": {}}
    for kind, t in frames.items():
        # periods run oldest first, so the last one is the newest
        periods = sorted(t["period"].unique(), key=lambda p: t.loc[t["period"] == p, "t"].min())
        passed, rows = [], []
        for name, mask in windows(t).items():
            s = t[mask]
            rows.append({"window": name, "trades": len(s), "won": float(s["win"].mean()) if len(s) else 0.0, "total": float(s["r"].sum()), "z": day_z(s)})
            if passes(s, periods, bar_z):
                passed.append(name)
        rows.sort(key=lambda r: r["z"])
        out["kinds"][kind] = {"trades": len(t), "from": t["t"].min().isoformat(), "to": t["t"].max().isoformat(), "total": float(t["r"].sum()), "sit_out": passed, "worst": rows[:6], "best": rows[-6:]}
        print(kind, "trades", len(t), "total", round(float(t["r"].sum()), 1), "passes:", passed or "none", flush=True)
        for r in rows[:6]:
            print(f"   {r['window']:28} trades {r['trades']:6} won {r['won']:.2%} total {r['total']:+8.1f} z {r['z']:+.2f}", flush=True)
    (ROOT / "docs" / "intel" / "time.json").write_text(json.dumps(out, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
