"""The study of losses (run_loss_causes.py) found the biggest cause is the whole market moving after entry. Can the InZone model trading now earn more by acting on that, or by training differently?
Report only: writes docs/intel/RISK.md and risk.json, and changes no model.

Judged as run_market_contest.py judges: all 17 coins, 3 separate 91-day periods it never trained on, a gap around each, then the newest 60 days.
  today             the model trading now.
  market forecast   a second model reads the chance that the whole market moves as far as this coin's corridor in the next hour. The riskiest fifth of readings is skipped. The limit comes
                    from the end of the training data, before the test period.
  at most 8 open    no more than 8 InZone trades open at once, so one market move cannot hit every coin together.
  recent 2 years    trains on the last 2 years only.
  more data         trains on up to 1,200,000 rows instead of 700,000.

RULE, FIXED 2026-11-07 BEFORE ANY RESULT OF THIS CONTEST WAS SEEN, not to be loosened: run_wide_contest.winner(), the same 8 rules, unchanged.
Honest limit: this is the third contest on these periods, and the newest 60 days have been seen twice. Each contest makes a lucky win more likely. So a winner goes live only after passing
run_wide_harder.py's rule on minutes no contest or earlier test has read, and it should be expected to earn less live than here. Usage: python intel/run_risk_contest.py"""
from __future__ import annotations

import gc
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_loss_causes as rlc                        # noqa: E402
import run_market_contest as rm                      # noqa: E402
import run_wide_contest as rw                        # noqa: E402
from engine.settings import ROOT                     # noqa: E402
from engine.updown import IZ_TRAINING, IZ_VERSION, money_proof   # noqa: E402

rt, lab = rw.rt, rw.lab
MOST_OPEN, SKIP_SHARE, MINUTES = 8, 0.2, 60
DAYS = 4 * 365
VERSIONS = {"today": {}, "market forecast": {"forecast": True}, f"at most {MOST_OPEN} open": {"cap": MOST_OPEN}, "recent 2 years": {"days": 2 * 365}, "more data": {"rows": 1_200_000}}


def at_most_open(take: pd.DataFrame, most: int) -> pd.DataFrame:
    """Oldest first. A trade that would be one too many is not taken."""
    keep, ends = [], []
    gap = pd.Timedelta(minutes=MINUTES)
    for i, when in zip(*(lambda s: (s.index, s["t"]))(take.sort_values("t"))):
        ends = [e for e in ends if e > when]
        if len(ends) < most:
            keep.append(i)
            ends.append(when + gap)
    return take.loc[keep]


def with_market_label(d: pd.DataFrame) -> pd.DataFrame:
    """The label for the forecast: did the average coin move as far as this coin's corridor in the next hour? Only ever an answer to train on, never an input."""
    market = rlc.market_moves(rlc.closes_by_coin())
    at = (d["t"] - pd.Timestamp(0, tz="UTC")) // pd.Timedelta(milliseconds=1)
    d["y_mkt"] = (market.reindex(at.to_numpy()).abs().to_numpy() >= d["zone_width"].to_numpy()).astype("int8")
    return d


def trades(x: pd.DataFrame, lo, hi, cols: list[str], cfg: dict, seed: int, cache: dict) -> pd.DataFrame:
    gap = pd.Timedelta(minutes=120)
    train = x[(x["t"] < lo - gap) & (x["t"] >= lo - pd.Timedelta(days=cfg.get("days", DAYS)))]
    test = x[(x["t"] >= lo) & (x["t"] < hi)]
    if "days" in cfg or "rows" in cfg:
        return rm.trades_on(train, test, {"cols": cols, "training": {**IZ_TRAINING_KEYS, "rows": cfg.get("rows", IZ_TRAINING_KEYS["rows"])}}, "inzone", seed)
    key = (lo, seed)
    if key not in cache:
        cache[key] = rm.trades_on(train, test, {"cols": cols, "training": IZ_TRAINING_KEYS}, "inzone", seed)
    take = cache[key]
    if "cap" in cfg:
        return at_most_open(take, cfg["cap"])
    if cfg.get("forecast"):
        cal = train[train["t"] >= train["t"].quantile(0.85)]
        p = rt._train_one(train, pd.concat([cal[cols + ["t"]], test[cols + ["t"]]], ignore_index=True), cols, "y_mkt", rw.TRAINING, seed)
        limit = float(np.quantile(p[:len(cal)], 1 - SKIP_SHARE))
        risk = pd.Series(p[len(cal):], index=test.index)
        return take[risk.loc[take.index] < limit]
    return take


IZ_TRAINING_KEYS = {k: IZ_TRAINING[k] for k in ("rows", "rounds", "lr", "blend")}


def judge(d: pd.DataFrame, cols: list[str]) -> dict:
    exam_from = d["t"].max() - pd.Timedelta(days=rw.EXAM_DAYS)
    last = exam_from - pd.Timedelta(minutes=120)
    cache: dict = {}
    out = {}
    for name, cfg in VERSIONS.items():
        runs, usual_runs, exams = [], [], []
        for seed in rw.SEEDS:
            taken, by_period = [], []
            for k in range(rw.PERIODS):
                hi = last - pd.Timedelta(days=rw.PERIOD_DAYS * k)
                take = trades(d, hi - pd.Timedelta(days=rw.PERIOD_DAYS), hi, cols, cfg, seed, cache)
                taken.append(take)
                by_period.append(float(take["r"].sum()) if len(take) else 0.0)
                gc.collect()
            all_taken = pd.concat(taken)
            runs.append(rt.score(all_taken, by_period))
            mine = all_taken[all_taken["coin"].isin(rw.USUAL)]
            usual_runs.append(float(mine["r"].sum()) if len(mine) else 0.0)
            exams.append(trades(d, exam_from, d["t"].max() + pd.Timedelta(minutes=120), cols, cfg, seed, cache))
        r = {k: float(np.mean([s[k] for s in runs])) for k in runs[0] if k != "periods"}
        r["periods"] = [float(a) for a in np.mean([s["periods"] for s in runs], axis=0)]
        r["periods_up"] = sum(1 for a in r["periods"] if a > 0)
        r["luck"] = float(np.std([s["avg"] for s in runs], ddof=1))
        r["usual_total"] = float(np.mean(usual_runs))
        r["money_proof"] = money_proof(r)
        r["exam_total"] = float(np.mean([float(e["r"].sum()) for e in exams]))
        r["exam_trades"] = float(np.mean([len(e) for e in exams]))
        r["exam_won"] = float(np.mean([float(e["win"].mean()) if len(e) else 0.0 for e in exams]))
        out[name] = r
        print(f"  {name}: {r['trades']:.0f} trades, won {r['won']:.2%}, avg {r['avg']:+.4f} (luck {r['luck']:.4f}), total {r['total']:+.1f}, worst run {r['max_dd']:.1f}, worst day {r['worst_day']:.1f}, low {r['low']:+.4f}, by period {[round(a, 1) for a in r['periods']]}, usual {r['usual_total']:+.1f}, exam {r['exam_trades']:.0f} trades won {r['exam_won']:.2%} total {r['exam_total']:+.1f}, proof {r['money_proof']}", flush=True)
    return out


def main() -> None:
    d = rm.build()
    all_cols = [c for c in d.columns if c not in rm.LABELS]
    cols = rm.versions(all_cols, "inzone")[IZ_VERSION]["cols"]
    d = with_market_label(d)
    print(f"{len(d):,} rows, market moved as far as the corridor on {d['y_mkt'].mean():.1%} of them", flush=True)
    results = judge(d, cols)
    pick = rw.winner(results)
    docs = ROOT / "docs" / "intel"
    (docs / "risk.json").write_text(json.dumps({"generated_at": datetime.now(timezone.utc).isoformat(), "pick": pick, "results": results}, indent=1), encoding="utf-8")
    lines = ["# Acting on the biggest cause of losses", "", f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC. Report only: nothing here changes a model. The rule is at the top of intel/run_risk_contest.py and was fixed before any result was seen.", "", "Totals are in units of the fixed stake per trade.", "",
             "| Version | Trades | Won | Average | Luck | Total | Worst run | Worst day | Corrected low | Periods up | Exam total | Money proof | Result |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|"]
    lines += [f"| {n} | {r['trades']:,.0f} | {r['won']:.2%} | {r['avg']:+.4f} | {r['luck']:.4f} | {r['total']:+.1f} | {r['max_dd']:.1f} | {r['worst_day']:.1f} | {r['low']:+.4f} | {r['periods_up']} of {rw.PERIODS} | {r['exam_total']:+.1f} | {'Yes' if r['money_proof'] else 'No'} | {'**Chosen**' if n == pick else ''} |" for n, r in results.items()]
    lines.append("")
    (docs / "RISK.md").write_text("\n".join(lines), encoding="utf-8")
    print("pick:", pick, flush=True)


if __name__ == "__main__":
    main()
