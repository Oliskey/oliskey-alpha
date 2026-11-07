"""Last test of the InZone version that won the all-coins contest, before it may trade anyone's money. Report only: writes docs/intel/wide_harder.json and
WIDE_HARDER.md, and changes no model.

RULE, FIXED 2026-11-07 BEFORE ANY RESULT OF THIS TEST WAS SEEN, not to be loosened. The contest read every 15th minute, starting from the same minute. This test
trains and judges the same version on different minutes (OFFSET), so it cannot pass by luck of which minutes were read. It is judged separately on the 5 usual coins and on the other 12.
A group of coins may receive users' money only if ALL hold for that group:
  1. money proof on the trades as tested (engine.updown.money_proof: corrected lower bound above zero, every period earns, no period above 60% of the profit);
  2. the same money proof entering LATE_MINUTES late, as live trades can;
  3. a profit on the newest EXAM_DAYS days, as tested and entering late.
A group that fails keeps trading no one's money. Usage: python intel/run_wide_harder.py"""
from __future__ import annotations

import gc
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_wide_contest as rw                                    # noqa: E402
from engine.longview import LONG, long_view                      # noqa: E402
from engine.settings import ROOT                                 # noqa: E402
from engine.updown import _frame, _sigma, ALL_COINS, IZ_BREAKEVEN, IZ_PAYOUT, IZ_Q, money_proof   # noqa: E402

rt, lab = rw.rt, rw.lab
OFFSET, LATE_MINUTES = 7, 2
GROUPS = {"usual": list(lab.COINS), "others": [s for s in ALL_COINS if s not in lab.COINS]}
LABELS = ("t", "y_iz", "y_iz_late", "coin_name")
MINUTES = rw.MINUTES


def build() -> pd.DataFrame:
    fng = lab.fear_greed()
    frames, btc = [], None
    for sym in ALL_COINS:      # Bitcoin comes first
        z = np.load(rw.FOLDER / f"{sym}.npz")
        df = pd.DataFrame({k: z[k] for k in ("t", "o", "h", "l", "c", "v", "tb")})
        f = _frame(df, 0, lab.funding(sym), fng).drop(columns="coin")
        if sym == "BTCUSDT":
            btc = f.set_index("t")[["r5", "r15"]].rename(columns={"r5": "btc5", "r15": "btc15"})
        f = f.join(btc, on="t")
        c, sigma = df["c"], _sigma(df["c"])
        f["y_iz"] = (np.log(c.shift(-MINUTES) / c).abs() <= IZ_Q * sigma * np.sqrt(MINUTES)).astype("int8")
        a, b = c.shift(-LATE_MINUTES), c.shift(-MINUTES - LATE_MINUTES)
        f["y_iz_late"] = (np.log(b / a).abs() <= IZ_Q * sigma.shift(-LATE_MINUTES) * np.sqrt(MINUTES)).astype("int8")
        extra = long_view(df)
        for col in LONG:
            f[col] = extra[col].to_numpy()
        f["coin_name"] = sym
        frames.append(f.iloc[1500 + OFFSET:-MINUTES - LATE_MINUTES - 10].iloc[::rw.STEP].copy())
        del f, df, extra, c, sigma
        gc.collect()
        print("features", sym, flush=True)
    d = pd.concat(frames, ignore_index=True)
    d["coin_name"] = d["coin_name"].astype("category")
    return d


def taken(test: pd.DataFrame, p: np.ndarray, label: str) -> pd.DataFrame:
    """The same trades the contest would take: one at a time per coin, only above break-even plus the margin."""
    t = test[["t"]].assign(coin=test["coin_name"].astype(str).to_numpy(), y=test[label].to_numpy(), p=p, up=True)
    t["conf"], t["win"] = t["p"], t["y"] == 1
    t["r"] = np.where(t["win"], IZ_PAYOUT, -1.0)
    return lab.one_at_a_time(t[t["conf"] > IZ_BREAKEVEN + lab.MARGIN], pd.Timedelta(minutes=MINUTES))


def part(take: pd.DataFrame, coins: list[str], periods: int) -> dict:
    """The score of one group of coins, one training run."""
    mine = take[take["coin"].isin(coins)]
    by_period = [float(mine[mine["period"] == k]["r"].sum()) for k in range(periods)]
    return rt.score(mine.drop(columns="period"), by_period)


def main() -> None:
    d = build()
    cols = [c for c in d.columns if c not in LABELS]
    print(f"{len(d):,} rows, offset {OFFSET}", flush=True)
    exam_from = d["t"].max() - pd.Timedelta(days=rw.EXAM_DAYS)
    gap = pd.Timedelta(minutes=MINUTES + 60)
    last = exam_from - gap
    runs: dict[str, list] = {f"{g}/{n}": [] for g in GROUPS for n in ("as_tested", "late")}
    exams: dict[str, list] = {k: [] for k in runs}
    per_coin: dict[str, list] = {"as_tested": [], "late": []}
    for seed in rw.SEEDS:
        found: dict[str, list] = {"as_tested": [], "late": []}
        for k in range(rw.PERIODS):
            hi = last - pd.Timedelta(days=rw.PERIOD_DAYS * k)
            lo = hi - pd.Timedelta(days=rw.PERIOD_DAYS)
            test = d[(d["t"] >= lo) & (d["t"] < hi)]
            train = d[(d["t"] < lo - gap) & (d["t"] >= lo - pd.Timedelta(days=4 * 365))]
            p = rt._train_one(train, test, cols, "y_iz", rw.TRAINING, seed)
            for name, label in (("as_tested", "y_iz"), ("late", "y_iz_late")):
                found[name].append(taken(test, p, label).assign(period=k))
            del train, test
            gc.collect()
        test = d[d["t"] >= exam_from]
        train = d[(d["t"] < exam_from - gap) & (d["t"] >= exam_from - pd.Timedelta(days=4 * 365))]
        p = rt._train_one(train, test, cols, "y_iz", rw.TRAINING, seed)
        for name, label in (("as_tested", "y_iz"), ("late", "y_iz_late")):
            take = pd.concat(found[name])
            per_coin[name].append(take.groupby("coin")["r"].sum())
            exam = taken(test, p, label)
            for g, coins in GROUPS.items():
                runs[f"{g}/{name}"].append(part(take, coins, rw.PERIODS))
                mine = exam[exam["coin"].isin(coins)]
                exams[f"{g}/{name}"].append({"total": float(mine["r"].sum()), "trades": len(mine), "won": float(mine["win"].mean()) if len(mine) else 0.0})
        del train, test
        gc.collect()
        print("seed done", seed, flush=True)
    results: dict = {"version": "long view (17, 4 years, days to months)", "offset": OFFSET, "late_minutes": LATE_MINUTES, "groups": {}}
    for g in GROUPS:
        out = {}
        for n in ("as_tested", "late"):
            rs = runs[f"{g}/{n}"]
            r = {k: float(np.mean([s[k] for s in rs])) for k in rs[0] if k != "periods"}
            r["periods"] = [float(a) for a in np.mean([s["periods"] for s in rs], axis=0)]
            r["luck"] = float(np.std([s["avg"] for s in rs], ddof=1))
            es = exams[f"{g}/{n}"]
            r["exam"] = {k: float(np.mean([e[k] for e in es])) for k in es[0]}
            r["money_proof"] = money_proof(r)
            out[n] = r
        out["passed"] = out["as_tested"]["money_proof"] and out["late"]["money_proof"] and out["as_tested"]["exam"]["total"] > 0 and out["late"]["exam"]["total"] > 0
        results["groups"][g] = out
    results["coins"] = {n: {k: float(a) for k, a in pd.concat(v, axis=1).fillna(0).mean(axis=1).items()} for n, v in per_coin.items()}
    docs = ROOT / "docs" / "intel"
    (docs / "wide_harder.json").write_text(json.dumps({"generated_at": datetime.now(timezone.utc).isoformat(), "results": results}, indent=1), encoding="utf-8")
    lines = ["# InZone long view: last test before users' money", "", f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC. Report only: nothing here changes a model. The rule is at the top of intel/run_wide_harder.py and was fixed before any result was seen.",
             "", "Totals are in units of the fixed stake per trade, averaged over training runs.", "", "| Coins | Test | Trades | Won | Average | Total | Corrected low | By period | Exam trades | Exam won | Exam total | Money proof |", "|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---|"]
    for g, out in results["groups"].items():
        for n, title in (("as_tested", "As tested"), ("late", f"{LATE_MINUTES} minutes late")):
            r = out[n]
            lines.append(f"| {'5 usual' if g == 'usual' else '12 others'} | {title} | {r['trades']:,.0f} | {r['won']:.2%} | {r['avg']:+.4f} | {r['total']:+.1f} | {r['low']:+.4f} | {[round(a, 1) for a in r['periods']]} | {r['exam']['trades']:,.0f} | {r['exam']['won']:.2%} | {r['exam']['total']:+.1f} | {'Yes' if r['money_proof'] else 'No'} |")
        lines.append(f"| {'5 usual' if g == 'usual' else '12 others'} | **Result** | | | | | | | | | | **{'Passed' if out['passed'] else 'Failed'}** |")
    lines.append("")
    (docs / "WIDE_HARDER.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({g: {"passed": o["passed"], **{n: {k: round(o[n][k], 4) if not isinstance(o[n][k], (list, dict)) else o[n][k] for k in ("trades", "won", "avg", "total", "low", "periods", "exam")} for n in ("as_tested", "late")}} for g, o in results["groups"].items()}), flush=True)
    print("coins", results["coins"], flush=True)


if __name__ == "__main__":
    main()
