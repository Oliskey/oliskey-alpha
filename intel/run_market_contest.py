"""Can the model trading now earn more with new inputs or stronger training? Report only: writes docs/intel/MARKET.md and market.json, and changes no model.

Judged as run_wide_contest.py judges: all 17 coins, 3 separate 91-day periods it never trained on, a gap around each, then the newest 60 days.
  today        InZone: the long view, live since 2026-11-07. Fixed Time: all coins, no long view.
  market       adds what all 17 coins are doing together.
  corridor     InZone only: adds how the corridor has been holding on this coin lately.
  both         InZone only: both of the above.
  both, longer InZone only: both, with 300 slower rounds of training.
  everything   Fixed Time only: adds the market and the long view.

RULE, FIXED 2026-11-07 BEFORE ANY RESULT OF THIS CONTEST WAS SEEN, not to be loosened: run_wide_contest.winner(), the same 8 rules, unchanged. A new version must beat today's by more
than training luck explains per trade, earn at least as much in total, with a corrected low no worse, as many periods up, a worst run no more than 10% larger, a profit on the 5 usual
coins, at least 500 trades, and a profit on the newest 60 days no less than today's.
Honest limit: those 60 days already helped choose today's InZone version, so they are no longer untouched. So a winner here goes live only after also passing run_wide_harder.py's rule on
different minutes, for each group of coins, and its live record must be read separately. Fixed Time gets no users' money unless it also passes the money proof.
Usage: python intel/run_market_contest.py"""
from __future__ import annotations

import gc
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_wide_contest as rw                                                        # noqa: E402
from engine.longview import LONG, long_view                                          # noqa: E402
from engine.marketview import CORRIDOR, corridor_view, MARKET, market_view           # noqa: E402
from engine.settings import ROOT                                                     # noqa: E402
from engine.updown import _frame, _sigma, ALL_COINS, IZ_Q, money_proof               # noqa: E402

rt, lab = rw.rt, rw.lab
LABELS = ("t", "y_ft", "y_iz", "coin_name")
LONGER = {**rw.TRAINING, "rounds": 300, "lr": 0.03}


def build() -> pd.DataFrame:
    fng = lab.fear_greed()
    closes = {}
    for sym in ALL_COINS:
        with np.load(rw.FOLDER / f"{sym}.npz") as z:
            closes[sym] = pd.Series(z["c"], index=z["t"].astype("int64"), dtype="float32")
    table = pd.DataFrame(closes)
    del closes
    market = {k: v.astype("float32") for k, v in market_view(table).items()}
    own_moves = np.log(table).diff(60).astype("float32")
    del table
    print("market view done", flush=True)
    frames, btc = [], None
    for sym in ALL_COINS:      # Bitcoin comes first
        z = np.load(rw.FOLDER / f"{sym}.npz")
        df = pd.DataFrame({k: z[k] for k in ("t", "o", "h", "l", "c", "v", "tb")})
        z.close()
        f = _frame(df, 0, lab.funding(sym), fng).drop(columns="coin")
        if sym == "BTCUSDT":
            btc = f.set_index("t")[["r5", "r15"]].rename(columns={"r5": "btc5", "r15": "btc15"})
        f = f.join(btc, on="t")
        c, sigma = df["c"], _sigma(df["c"])
        f["y_ft"] = np.where(c.shift(-60) > c, 1, np.where(c.shift(-60) < c, 0, -1)).astype("int8")
        f["y_iz"] = (np.log(c.shift(-60) / c).abs() <= IZ_Q * sigma * np.sqrt(60)).astype("int8")
        extra = long_view(df)
        for col in LONG:
            f[col] = extra[col].to_numpy()
        at = df["t"].astype("int64").to_numpy()
        for col, series in market.items():
            f[col] = series.reindex(at).to_numpy()
        f["own_vs_mkt_60"] = own_moves[sym].reindex(at).to_numpy(dtype="float32") - f["mkt_ret_60"].to_numpy()
        corridor = corridor_view(c, df["h"], df["l"], sigma, IZ_Q)
        for col in CORRIDOR:
            f[col] = corridor[col].to_numpy()
        f["coin_name"] = sym
        frames.append(f.iloc[1500:-70].iloc[::rw.STEP].copy())
        del f, df, extra, c, sigma, corridor
        gc.collect()
        print("features", sym, flush=True)
    d = pd.concat(frames, ignore_index=True)
    d["coin_name"] = d["coin_name"].astype("category")
    return d


def versions(cols: list[str], kind: str) -> dict:
    plain = [c for c in cols if c not in LONG + MARKET + CORRIDOR]
    long = plain + LONG
    if kind == "fixed_time":
        return {"today": {"cols": plain, "training": rw.TRAINING}, "market": {"cols": plain + MARKET, "training": rw.TRAINING}, "everything": {"cols": long + MARKET, "training": rw.TRAINING}}
    return {"today": {"cols": long, "training": rw.TRAINING}, "market": {"cols": long + MARKET, "training": rw.TRAINING}, "corridor": {"cols": long + CORRIDOR, "training": rw.TRAINING},
            "both": {"cols": long + MARKET + CORRIDOR, "training": rw.TRAINING}, "both, longer": {"cols": long + MARKET + CORRIDOR, "training": LONGER}}


def trades_on(train: pd.DataFrame, test: pd.DataFrame, v: dict, kind: str, seed: int) -> pd.DataFrame:
    y, payout, be, directional = rw.KINDS[kind]
    t = test[["t", "coin_name"]].rename(columns={"coin_name": "coin"}).assign(y=test[y].to_numpy(), p=rt._train_one(train, test, v["cols"], y, v["training"], seed))
    t["coin"] = t["coin"].astype(str)
    if directional:
        up = t["p"] > 0.5
        t["conf"], t["win"], t["up"] = np.where(up, t["p"], 1 - t["p"]), np.where(up, t["y"] == 1, t["y"] == 0), up
    else:
        t["up"], t["conf"], t["win"] = True, t["p"], t["y"] == 1
    t["r"] = np.where(t["win"], payout, -1.0)
    return lab.one_at_a_time(t[t["conf"] > be + lab.MARGIN], pd.Timedelta(minutes=60))


def judge(d: pd.DataFrame, cols: list[str], kind: str) -> dict:
    y = rw.KINDS[kind][0]
    x = d[d[y] >= 0]
    exam_from = x["t"].max() - pd.Timedelta(days=rw.EXAM_DAYS)
    gap = pd.Timedelta(minutes=120)
    last = exam_from - gap
    out = {}
    for name, v in versions(cols, kind).items():
        runs, usual_runs, exams = [], [], []
        for seed in rw.SEEDS:
            taken, by_period = [], []
            for k in range(rw.PERIODS):
                hi = last - pd.Timedelta(days=rw.PERIOD_DAYS * k)
                lo = hi - pd.Timedelta(days=rw.PERIOD_DAYS)
                take = trades_on(x[(x["t"] < lo - gap) & (x["t"] >= lo - pd.Timedelta(days=4 * 365))], x[(x["t"] >= lo) & (x["t"] < hi)], v, kind, seed)
                taken.append(take)
                by_period.append(float(take["r"].sum()) if len(take) else 0.0)
                gc.collect()
            all_taken = pd.concat(taken)
            runs.append(rt.score(all_taken, by_period))
            mine = all_taken[all_taken["coin"].isin(rw.USUAL)]
            usual_runs.append(float(mine["r"].sum()) if len(mine) else 0.0)
            exams.append(trades_on(x[(x["t"] < exam_from - gap) & (x["t"] >= exam_from - pd.Timedelta(days=4 * 365))], x[x["t"] >= exam_from], v, kind, seed))
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
        print(f"  {kind} {name}: {r['trades']:.0f} trades, won {r['won']:.2%}, avg {r['avg']:+.4f} (luck {r['luck']:.4f}), total {r['total']:+.1f}, worst run {r['max_dd']:.1f}, worst day {r['worst_day']:.1f}, low {r['low']:+.4f}, by period {[round(a, 1) for a in r['periods']]}, usual {r['usual_total']:+.1f}, exam {r['exam_trades']:.0f} trades won {r['exam_won']:.2%} total {r['exam_total']:+.1f}, proof {r['money_proof']}", flush=True)
    return out


def main() -> None:
    d = build()
    cols = [c for c in d.columns if c not in LABELS]
    print(f"{len(d):,} rows", flush=True)
    results = {kind: judge(d, cols, kind) for kind in ("inzone", "fixed_time")}
    picks = {k: rw.winner(v) for k, v in results.items()}
    docs = ROOT / "docs" / "intel"
    (docs / "market.json").write_text(json.dumps({"generated_at": datetime.now(timezone.utc).isoformat(), "picks": picks, "results": results}, indent=1), encoding="utf-8")
    lines = ["# New inputs and stronger training", "", f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC. Report only: nothing here changes a model. The rule is at the top of intel/run_market_contest.py and was fixed before any result was seen.", "", "Totals are in units of the fixed stake per trade.", ""]
    for kind, res in results.items():
        lines += [f"## {'InZone' if kind == 'inzone' else 'Fixed Time'}", "", "| Version | Trades | Won | Average | Luck | Total | Worst run | Worst day | Corrected low | Periods up | Exam total | Money proof | Result |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|"]
        lines += [f"| {n} | {r['trades']:,.0f} | {r['won']:.2%} | {r['avg']:+.4f} | {r['luck']:.4f} | {r['total']:+.1f} | {r['max_dd']:.1f} | {r['worst_day']:.1f} | {r['low']:+.4f} | {r['periods_up']} of {rw.PERIODS} | {r['exam_total']:+.1f} | {'Yes' if r['money_proof'] else 'No'} | {'**Chosen**' if n == picks[kind] else ''} |" for n, r in res.items()]
        lines.append("")
    (docs / "MARKET.md").write_text("\n".join(lines), encoding="utf-8")
    print("picks:", picks, flush=True)


if __name__ == "__main__":
    main()
