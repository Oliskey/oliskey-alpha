"""The owner's rule, 2026-11-07: if the AI is not sure of a trade, it is better not to trade than to lose money. This test turns "sure" into a number, for InZone. Writes docs/intel/STRENGTH.md and
strength.json. Runs weekly. The live scan reads "sure_bar" and never trades below it. It can only raise the bar above break-even plus the margin, never lower it.

It trains the live version as it was judged, on minutes other tests did not read, on 3 separate periods it never trained on and on the newest 60 days. Trades are split into levels by reading.

RULES, FIXED 2026-11-07 BEFORE ANY RESULT WAS SEEN, not to be loosened.
SURE BAR: a level of readings is sure only if, entering LATE minutes late as live trades can, the trades in that level alone
  1. pass the money proof (engine.updown.money_proof: corrected lower bound above zero, every period earns, no period above 60% of the profit), and
  2. make a profit on the newest 60 days.
A level with fewer than MIN_TRADES trades cannot be judged alone and does not count either way. The sure bar is the lowest level from which every judged level upward is sure. If there is none,
the AI does not trade InZone at all.
STRONGEST SIGNALS, the users' option: the highest bar where all trades at or above it number at least MIN_TRADES and pass the same 2 tests, as tested and entering late. If there is none, the option
is not offered. Win rates shown are test results, never a promise. Usage: python intel/run_strength_test.py"""
from __future__ import annotations

import gc
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_market_contest as rm                                                  # noqa: E402
import run_wide_contest as rw                                                    # noqa: E402
from engine.settings import ROOT                                                 # noqa: E402
from engine.updown import IZ_BREAKEVEN, IZ_PAYOUT, IZ_VERSION, money_proof       # noqa: E402

rt, lab = rw.rt, rw.lab
OFFSET, LATE, MIN_TRADES = 3, 2, 500
BARS = (IZ_BREAKEVEN + lab.MARGIN, 0.50, 0.52, 0.54, 0.56, 0.58, 0.60, 0.65, 0.70)
LABELS = {"as_tested": "y_iz", "late": "y_iz_late"}


def taken_at(rows: pd.DataFrame, bar: float, label: str) -> pd.DataFrame:
    """The trades at this bar: one at a time per coin, so a higher bar can take a later minute instead."""
    t = rows[rows["p"] > bar][["t", "coin", "p"]].assign(y=rows.loc[rows["p"] > bar, label].to_numpy(), up=True)
    t["conf"], t["win"] = t["p"], t["y"] == 1
    t["r"] = np.where(t["win"], IZ_PAYOUT, -1.0)
    return lab.one_at_a_time(t, pd.Timedelta(minutes=60))


def measure(seeds: list[dict], bar: float, below: float, label: str) -> dict:
    """Trades taken at this bar with readings under `below`, across the training runs."""
    runs, exams = [], []
    for s in seeds:
        parts = [taken_at(r, bar, label) for r in s["periods"]]
        parts = [p[p["conf"] < below] for p in parts]
        runs.append(rt.score(pd.concat(parts), [float(p["r"].sum()) for p in parts]))
        e = taken_at(s["exam"], bar, label)
        e = e[e["conf"] < below]
        exams.append({"total": float(e["r"].sum()), "trades": len(e), "won": float(e["win"].mean()) if len(e) else 0.0})
    r = {k: float(np.mean([x[k] for x in runs])) for k in runs[0] if k != "periods"}
    r["periods"] = [float(a) for a in np.mean([x["periods"] for x in runs], axis=0)]
    r["exam"] = {k: float(np.mean([x[k] for x in exams])) for k in exams[0]}
    r["proof"] = money_proof(r) and r["exam"]["total"] > 0
    return r


def choose_sure_bar(levels: list[dict]) -> float | None:
    """levels: lowest first, each with bar, trades and proof. The lowest level from which every judged level upward passes."""
    bar = None
    for level in reversed(levels):
        if level["trades"] < MIN_TRADES:
            continue
        if not level["proof"]:
            break
        bar = level["bar"]
    return bar


def choose_strongest(tops: list[dict]) -> float | None:
    """tops: each with bar, trades and proof (as tested and late). The highest bar that passes."""
    good = [t["bar"] for t in tops if t["trades"] >= MIN_TRADES and t["proof"]]
    return max(good) if good else None


def main() -> None:
    d = rm.build(OFFSET, LATE)
    cols = [c for c in d.columns if c not in (*rm.LABELS, "y_iz_late")]
    v = rm.versions(cols, "inzone")[IZ_VERSION]
    exam_from = d["t"].max() - pd.Timedelta(days=rw.EXAM_DAYS)
    gap = pd.Timedelta(minutes=120)
    last = exam_from - gap

    def read(lo, hi, seed: int) -> pd.DataFrame:
        train = d[(d["t"] < lo - gap) & (d["t"] >= lo - pd.Timedelta(days=4 * 365))]
        test = d[(d["t"] >= lo) & (d["t"] < hi)]
        p = rt._train_one(train, test, v["cols"], "y_iz", v["training"], seed)
        out = pd.DataFrame({"t": test["t"].to_numpy(), "coin": test["coin_name"].astype(str).to_numpy(), "y_iz": test["y_iz"].to_numpy(), "y_iz_late": test["y_iz_late"].to_numpy(), "p": p})
        out["t"] = pd.to_datetime(out["t"], utc=True)
        gc.collect()
        return out

    seeds = []
    for seed in rw.SEEDS:
        periods = [read(last - pd.Timedelta(days=rw.PERIOD_DAYS * (k + 1)), last - pd.Timedelta(days=rw.PERIOD_DAYS * k), seed) for k in range(rw.PERIODS)]
        seeds.append({"periods": periods, "exam": read(exam_from, d["t"].max() + gap, seed)})
        print("seed done", seed, flush=True)
    del d
    gc.collect()
    levels, tops = [], []
    for i, bar in enumerate(BARS):
        below = BARS[i + 1] if i + 1 < len(BARS) else 2.0
        m = measure(seeds, bar, below, "y_iz_late")
        levels.append({"bar": bar, "below": below if below < 2 else None, "trades": m["trades"], "won": m["won"], "avg": m["avg"], "total": m["total"], "low": m["low"], "periods": m["periods"], "exam": m["exam"], "proof": m["proof"]})
        tested, late = measure(seeds, bar, 2.0, "y_iz"), measure(seeds, bar, 2.0, "y_iz_late")
        tops.append({"bar": bar, "trades": late["trades"], "won": tested["won"], "won_late": late["won"], "avg_late": late["avg"], "total_late": late["total"], "worst_day_late": late["worst_day"], "max_dd_late": late["max_dd"], "per_day": late["trades"] / (rw.PERIODS * rw.PERIOD_DAYS), "exam_late": late["exam"], "proof": tested["proof"] and late["proof"]})
        print(f"  bar {bar:.4f}: level {m['trades']:.0f} trades won {m['won']:.2%} total {m['total']:+.1f} low {m['low']:+.4f} exam {m['exam']['total']:+.1f} proof {m['proof']} | all above: {late['trades']:.0f} trades, {tops[-1]['per_day']:.1f} a day, won {tested['won']:.2%} late {late['won']:.2%} total {late['total']:+.1f} worst day {late['worst_day']:.1f} exam {late['exam']['total']:+.1f} proof {tops[-1]['proof']}", flush=True)
    sure, strongest = choose_sure_bar(levels), choose_strongest(tops)
    out = {"generated_at": datetime.now(timezone.utc).isoformat(), "version": IZ_VERSION, "sure_bar": sure, "strongest_bar": strongest, "levels": levels, "tops": tops}
    docs = ROOT / "docs" / "intel"
    (docs / "strength.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    lines = ["# If it is not sure, it does not trade", "", f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC. The rules are at the top of intel/run_strength_test.py and were fixed before any result was seen. Test results, not a promise. InZone breaks even at {IZ_BREAKEVEN:.2%}.", "",
             f"**Sure bar: {'none: it does not trade InZone' if sure is None else f'{sure:.4f}'}. Strongest signals: {'not offered' if strongest is None else f'{strongest:.2f}'}.**", "", "## Each level of reading alone, entering late", "", "| Reading | Trades | Won | Per trade | Total | Newest 60 days | Sure |", "|---|---:|---:|---:|---:|---:|---|"]
    lines += [f"| {x['bar']:.3f}{' and up' if x['below'] is None else ' to ' + format(x['below'], '.3f')} | {x['trades']:,.0f} | {x['won']:.2%} | {x['avg']:+.4f} | {x['total']:+.1f} | {x['exam']['total']:+.1f} | {'Too few to judge' if x['trades'] < MIN_TRADES else 'Yes' if x['proof'] else 'No'} |" for x in levels]
    lines += ["", "## Everything at or above a bar", "", "| Bar | Trades | A day | Won | Won, late | Total, late | Worst day, late | Newest 60 days, late | Passes |", "|---|---:|---:|---:|---:|---:|---:|---:|---|"]
    lines += [f"| {x['bar']:.3f} | {x['trades']:,.0f} | {x['per_day']:.1f} | {x['won']:.2%} | {x['won_late']:.2%} | {x['total_late']:+.1f} | {x['worst_day_late']:.1f} | {x['exam_late']['total']:+.1f} | {'Yes' if x['proof'] else 'No'} |" for x in tops]
    lines.append("")
    (docs / "STRENGTH.md").write_text("\n".join(lines), encoding="utf-8")
    print("sure bar", sure, "strongest", strongest, flush=True)


if __name__ == "__main__":
    main()
