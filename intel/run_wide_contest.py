"""Does training on all 17 coins and 4 years, with daily, weekly and monthly context, earn more than today's model? Report only: writes docs/intel/WIDE.md and
wide.json, and changes no model. Every version is judged on the same thing: all 17 coins, on 3 separate 91-day periods it never trained on, with a gap around each.

  today       5 coins, 3 years, blend of 3 (the current winner). The other 12 coins get no coin number, as they do live.
  all coins   17 coins, 4 years, blend of 3, no coin number for any coin, so it must learn what holds across coins.
  long view   the same, plus context from days to months: returns over 1, 3, 7 and 30 days, distance from the 200-day average, where the price sits in its 30-day range,
              and how jumpy this week and month have been compared with the last 90 days.

RULE, FIXED BEFORE ANY RESULT WAS SEEN, not to be loosened afterwards. A new version replaces today's only if, for that trade type, ALL hold:
  1. average per trade higher than today's by more than training luck explains, and by at least 0.005;
  2. total profit at least as high; 3. corrected lower bound no worse; 4. as many periods in profit;
  5. worst losing run no more than 10% larger; 6. still in profit on the 5 usual coins alone;
  7. at least 500 trades.
Usage: python intel/run_wide_contest.py (needs intel/fetch_history.py first)"""
from __future__ import annotations

import gc
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_train_hard as rt                                     # noqa: E402
from engine.settings import ROOT                                # noqa: E402
from engine.updown import _frame, _sigma, ALL_COINS, BREAKEVEN, IZ_BREAKEVEN, IZ_PAYOUT, IZ_Q, PAYOUT   # noqa: E402

lab = rt.lab
FOLDER = lab.CACHE / "all"
STEP = 15             # every 15th minute: the answers span 60 minutes, and all 17 coins must fit in memory
SEEDS = (7, 42)
PERIODS, PERIOD_DAYS, MINUTES = rt.PERIODS, rt.PERIOD_DAYS, rt.MINUTES
LABELS = ("t", "y_ft", "y_iz", "coin_name")
LONG = ["ret_1d", "ret_3d", "ret_7d", "ret_30d", "dist_200d", "range_30d", "vol_7d", "vol_30d"]
KINDS = {"fixed_time": ("y_ft", PAYOUT, BREAKEVEN, True), "inzone": ("y_iz", IZ_PAYOUT, IZ_BREAKEVEN, False)}
USUAL = list(lab.COINS)
DAY = 1440


def long_view(df: pd.DataFrame) -> pd.DataFrame:
    """From that minute and earlier only."""
    c = df["c"]
    log = np.log(c)
    out = pd.DataFrame(index=df.index)
    for name, days in (("ret_1d", 1), ("ret_3d", 3), ("ret_7d", 7), ("ret_30d", 30)):
        out[name] = log - log.shift(days * DAY)
    # daily closes for the longest windows: far lighter than rolling over 288,000 minutes, and it cannot see ahead
    day = pd.to_datetime(df["t"], unit="ms", utc=True).dt.floor("D")
    closes = c.groupby(day).last()
    average = closes.rolling(200, min_periods=120).mean().shift(1)     # finished days only
    out["dist_200d"] = (log - np.log(day.map(average))).to_numpy()
    hi, lo = df["h"].rolling(30 * DAY, min_periods=10 * DAY).max(), df["l"].rolling(30 * DAY, min_periods=10 * DAY).min()
    out["range_30d"] = (c - lo) / (hi - lo).replace(0, np.nan)
    move = log.diff()
    daily_var = (move ** 2).groupby(day).sum()
    base = daily_var.rolling(90, min_periods=30).mean().shift(1)
    out["vol_7d"] = (np.log(daily_var.rolling(7).mean().shift(1) / base)).reindex(day).to_numpy()
    out["vol_30d"] = (np.log(daily_var.rolling(30, min_periods=15).mean().shift(1) / base)).reindex(day).to_numpy()
    return out.astype("float32")


def build() -> pd.DataFrame:
    fng = lab.fear_greed()
    frames, btc = [], None
    usual = list(lab.COINS)
    for sym in ALL_COINS:      # Bitcoin comes first
        z = np.load(FOLDER / f"{sym}.npz")
        df = pd.DataFrame({k: z[k] for k in ("t", "o", "h", "l", "c", "v", "tb")})
        f = _frame(df, 0, lab.funding(sym), fng)
        f["coin"] = float(usual.index(sym)) if sym in usual else np.nan
        if sym == "BTCUSDT":
            btc = f.set_index("t")[["r5", "r15"]].rename(columns={"r5": "btc5", "r15": "btc15"})
        f = f.join(btc, on="t")
        c = df["c"]
        f["y_ft"] = np.where(c.shift(-MINUTES) > c, 1, np.where(c.shift(-MINUTES) < c, 0, -1)).astype("int8")
        f["y_iz"] = (np.log(c.shift(-MINUTES) / c).abs() <= IZ_Q * _sigma(c) * np.sqrt(MINUTES)).astype("int8")
        extra = long_view(df)
        for col in LONG:
            f[col] = extra[col].to_numpy()
        f["coin_name"] = sym
        frames.append(f.iloc[1500:-MINUTES - 10].iloc[::STEP].copy())
        del f, df, extra, c
        gc.collect()
        print("features", sym, flush=True)
    d = pd.concat(frames, ignore_index=True)
    d["coin_name"] = d["coin_name"].astype("category")
    return d


def versions(cols: list[str]) -> dict:
    plain = [c for c in cols if c not in LONG]
    no_coin = [c for c in plain if c != "coin"]
    return {
        "today (5 coins, 3 years)": {"coins": USUAL, "days": 3 * 365, "cols": plain},
        "all coins (17, 4 years)": {"coins": None, "days": 4 * 365, "cols": no_coin},
        "long view (17, 4 years, days to months)": {"coins": None, "days": 4 * 365, "cols": no_coin + LONG},
    }


def judge(d: pd.DataFrame, cols: list[str], kind: str) -> dict:
    y, payout, be, directional = KINDS[kind]
    x = d[d[y] >= 0]
    last, gap = x["t"].max(), pd.Timedelta(minutes=MINUTES + 60)
    out = {}
    for name, v in versions(cols).items():
        v_train = {"rows": 700_000, "rounds": 150, "lr": None, "blend": 3}
        runs, usual_runs = [], []
        for seed in SEEDS:
            taken, by_period = [], []
            for k in range(PERIODS):
                hi = last - pd.Timedelta(days=PERIOD_DAYS * k)
                lo = hi - pd.Timedelta(days=PERIOD_DAYS)
                test = x[(x["t"] >= lo) & (x["t"] < hi)]
                train = x[(x["t"] < lo - gap) & (x["t"] >= lo - pd.Timedelta(days=v["days"]))]
                if v["coins"]:
                    train = train[train["coin_name"].isin(v["coins"])]
                t = test[["t", "coin_name"]].rename(columns={"coin_name": "coin"}).assign(y=test[y].to_numpy(), p=rt._train_one(train, test, v["cols"], y, v_train, seed))
                t["coin"] = t["coin"].astype(str)
                if directional:
                    up = t["p"] > 0.5
                    t["conf"] = np.where(up, t["p"], 1 - t["p"])
                    t["win"] = np.where(up, t["y"] == 1, t["y"] == 0)
                    t["up"] = up
                else:
                    t["up"] = True
                    t["conf"], t["win"] = t["p"], t["y"] == 1
                t["r"] = np.where(t["win"], payout, -1.0)
                take = lab.one_at_a_time(t[t["conf"] > be + lab.MARGIN], pd.Timedelta(minutes=MINUTES))
                taken.append(take)
                by_period.append(float(take["r"].sum()) if len(take) else 0.0)
                del train, test, t
                gc.collect()
            all_taken = pd.concat(taken)
            runs.append(rt.score(all_taken, by_period))
            mine = all_taken[all_taken["coin"].isin(USUAL)]
            usual_runs.append(float(mine["r"].sum()) if len(mine) else 0.0)
        r = {k: float(np.mean([s[k] for s in runs])) for k in runs[0] if k != "periods"}
        r["periods"] = [float(a) for a in np.mean([s["periods"] for s in runs], axis=0)]
        r["periods_up"] = sum(1 for a in r["periods"] if a > 0)
        r["luck"] = float(np.std([s["avg"] for s in runs], ddof=1))
        r["usual_total"] = float(np.mean(usual_runs))
        out[name] = r
        print(f"  {kind} {name}: {r['trades']:.0f} trades, won {r['won']:.2%}, avg {r['avg']:+.4f} (luck {r['luck']:.4f}), total {r['total']:+.1f}, worst run {r['max_dd']:.1f}, worst day {r['worst_day']:.1f}, low {r['low']:+.4f}, by period {[round(a, 1) for a in r['periods']]}, usual coins {r['usual_total']:+.1f}, up {r['up_share']:.0%}, top coin {r['top_coin']:.0%}", flush=True)
    return out


def winner(res: dict) -> str:
    names = list(res)
    base, best = res[names[0]], names[0]
    for n in names[1:]:
        r = res[n]
        need = max(0.005, 2 * math.sqrt((r["luck"] ** 2 + base["luck"] ** 2) / len(SEEDS)))
        if (r["trades"] >= 500 and r["avg"] >= base["avg"] + need and r["total"] >= base["total"] and r["low"] >= base["low"] and r["periods_up"] >= base["periods_up"]
                and r["max_dd"] <= base["max_dd"] * 1.1 and r["usual_total"] > 0 and r["total"] > res[best]["total"]):
            best = n
    return best


def main() -> None:
    d = build()
    cols = [c for c in d.columns if c not in LABELS]
    print(f"{len(d):,} rows, {d['coin_name'].nunique()} coins, {d['t'].min():%Y-%m-%d} to {d['t'].max():%Y-%m-%d}", flush=True)
    results = {kind: judge(d, cols, kind) for kind in KINDS}
    picks = {k: winner(v) for k, v in results.items()}
    docs = ROOT / "docs" / "intel"
    (docs / "wide.json").write_text(json.dumps({"generated_at": datetime.now(timezone.utc).isoformat(), "picks": picks, "results": results}, indent=1), encoding="utf-8")
    lines = ["# All coins and the long view", "", f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC from {len(d):,} real readings of {d['coin_name'].nunique()} coins, {d['t'].min():%Y-%m-%d} to {d['t'].max():%Y-%m-%d}.",
             "Report only: nothing here changes a model. The rule is at the top of intel/run_wide_contest.py and was fixed before any result was seen. Totals and worst runs are in units of the fixed stake per trade.", ""]
    for kind, res in results.items():
        lines += [f"## {'Fixed Time' if kind == 'fixed_time' else 'InZone'}", "", "| Version | Trades | Won | Average | Luck | Total | Worst run | Worst day | Corrected low | Periods up | Usual coins | Result |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|"]
        lines += [f"| {n} | {r['trades']:,.0f} | {r['won']:.2%} | {r['avg']:+.4f} | {r['luck']:.4f} | {r['total']:+.1f} | {r['max_dd']:.1f} | {r['worst_day']:.1f} | {r['low']:+.4f} | {r['periods_up']} of {PERIODS} | {r['usual_total']:+.1f} | {'**Chosen**' if n == picks[kind] else ''} |" for n, r in res.items()]
        lines.append("")
    (docs / "WIDE.md").write_text("\n".join(lines), encoding="utf-8")
    print("picks:", picks, flush=True)


if __name__ == "__main__":
    main()
