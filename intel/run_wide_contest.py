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
  7. at least 500 trades;
  8. HELD-BACK EXAM, added 2026-11-07 before this contest had ever run: the newest 60 days play no part in rules 1 to 7. On them the
     winner must make a profit, and no less than today's version. Otherwise today's version stays.

TRADE LENGTH, owner's rule 2026-11-07, fixed before this contest ran (earlier research on an older model had shown 15-minute InZone earning): a longer
trade is used only if it is really better. 15-minute InZone replaces 60-minute only if it passes the money proof, earns in the exam, and its total profit
over the same days is not lower than the 60-minute total by more than training luck explains. Fixed Time stays at 60 minutes: shorter lost in research.
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
from engine.updown import _frame, _sigma, ALL_COINS, BREAKEVEN, IZ_BREAKEVEN, IZ_PAYOUT, IZ_Q, money_proof, PAYOUT   # noqa: E402

lab = rt.lab
FOLDER = lab.CACHE / "all"
STEP = 15             # every 15th minute: the answers span 60 minutes, and all 17 coins must fit in memory
SEEDS = (7, 42)
EXAM_DAYS = 60        # the newest days, kept out of every choice
TRAINING = {"rows": 700_000, "rounds": 150, "lr": None, "blend": 3}
PERIODS, PERIOD_DAYS, MINUTES = rt.PERIODS, rt.PERIOD_DAYS, rt.MINUTES
LABELS = ("t", "y_ft", "y_iz", "y_iz15", "coin_name")
LONG = ["ret_1d", "ret_3d", "ret_7d", "ret_30d", "dist_200d", "range_30d", "vol_7d", "vol_30d"]
KINDS = {"fixed_time": ("y_ft", PAYOUT, BREAKEVEN, True), "inzone": ("y_iz", IZ_PAYOUT, IZ_BREAKEVEN, False), "inzone_15": ("y_iz15", IZ_PAYOUT, IZ_BREAKEVEN, False)}
LENGTH = {"fixed_time": MINUTES, "inzone": MINUTES, "inzone_15": 15}
TITLES = {"fixed_time": "Fixed Time", "inzone": "InZone, 60 minutes", "inzone_15": "InZone, 15 minutes"}
USUAL = list(lab.COINS)
READINGS = lab.CACHE / "readings"
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
        f["y_iz15"] = (np.log(c.shift(-15) / c).abs() <= IZ_Q * _sigma(c) * np.sqrt(15)).astype("int8")
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


def trades_on(train: pd.DataFrame, test: pd.DataFrame, v: dict, kind: str, seed: int) -> pd.DataFrame:
    """The trades one training run would take on the test rows, one at a time per coin as tested."""
    y, payout, be, directional = KINDS[kind]
    if v["coins"]:
        train = train[train["coin_name"].isin(v["coins"])]
    t = test[["t", "coin_name"]].rename(columns={"coin_name": "coin"}).assign(y=test[y].to_numpy(), p=rt._train_one(train, test, v["cols"], y, TRAINING, seed))
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
    return lab.one_at_a_time(t[t["conf"] > be + lab.MARGIN], pd.Timedelta(minutes=LENGTH[kind]))


def judge(d: pd.DataFrame, cols: list[str], kind: str) -> dict:
    y = KINDS[kind][0]
    x = d[d[y] >= 0]
    exam_from = x["t"].max() - pd.Timedelta(days=EXAM_DAYS)
    last, gap = exam_from - pd.Timedelta(minutes=MINUTES + 60), pd.Timedelta(minutes=MINUTES + 60)
    out = {}
    READINGS.mkdir(exist_ok=True)
    for name, v in versions(cols).items():
        runs, usual_runs, coin_runs, saved = [], [], [], []
        for seed in SEEDS:
            taken, by_period = [], []
            for k in range(PERIODS):
                hi = last - pd.Timedelta(days=PERIOD_DAYS * k)
                lo = hi - pd.Timedelta(days=PERIOD_DAYS)
                test = x[(x["t"] >= lo) & (x["t"] < hi)]
                train = x[(x["t"] < lo - gap) & (x["t"] >= lo - pd.Timedelta(days=v["days"]))]
                take = trades_on(train, test, v, kind, seed).assign(period=k)
                taken.append(take)
                by_period.append(float(take["r"].sum()) if len(take) else 0.0)
                del train, test
                gc.collect()
            all_taken = pd.concat(taken)
            coin_runs.append(all_taken.groupby("coin")["r"].sum())
            if seed == SEEDS[0]:
                saved = all_taken[["t", "coin", "period", "conf", "win", "r"]]
            runs.append(rt.score(all_taken, by_period))
            mine = all_taken[all_taken["coin"].isin(USUAL)]
            usual_runs.append(float(mine["r"].sum()) if len(mine) else 0.0)
        r = {k: float(np.mean([s[k] for s in runs])) for k in runs[0] if k != "periods"}
        r["periods"] = [float(a) for a in np.mean([s["periods"] for s in runs], axis=0)]
        r["periods_up"] = sum(1 for a in r["periods"] if a > 0)
        r["luck"] = float(np.std([s["avg"] for s in runs], ddof=1))
        r["usual_total"] = float(np.mean(usual_runs))
        r["coins"] = {k: float(a) for k, a in pd.concat(coin_runs, axis=1).fillna(0).mean(axis=1).items()}
        r["money_proof"] = money_proof(r)
        exam_test = x[x["t"] >= exam_from]
        exam_train = x[(x["t"] < exam_from - gap) & (x["t"] >= exam_from - pd.Timedelta(days=v["days"]))]
        exams = [trades_on(exam_train, exam_test, v, kind, seed) for seed in SEEDS]
        r["exam_total"] = float(np.mean([float(e["r"].sum()) for e in exams]))
        r["exam_trades"] = float(np.mean([len(e) for e in exams]))
        r["exam_won"] = float(np.mean([float(e["win"].mean()) if len(e) else 0.0 for e in exams]))
        del exam_test, exam_train, exams
        gc.collect()
        saved.to_pickle(READINGS / f"{kind}__{name.split(' (')[0].replace(' ', '_')}.pkl")
        out[name] = r
        print(f"  {kind} {name}: {r['trades']:.0f} trades, won {r['won']:.2%}, avg {r['avg']:+.4f} (luck {r['luck']:.4f}), total {r['total']:+.1f}, worst run {r['max_dd']:.1f}, worst day {r['worst_day']:.1f}, low {r['low']:+.4f}, by period {[round(a, 1) for a in r['periods']]}, usual coins {r['usual_total']:+.1f}, up {r['up_share']:.0%}, top coin {r['top_coin']:.0%}, exam {r['exam_trades']:.0f} trades won {r['exam_won']:.2%} total {r['exam_total']:+.1f}", flush=True)
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
    return best if res[best]["exam_total"] > 0 and res[best]["exam_total"] >= base["exam_total"] else names[0]


def length_choice(long: dict, short: dict) -> str:
    """The owner's rule at the top of this file. Both are the chosen versions, measured over the same days at the same stake."""
    luck = 2 * math.sqrt((long["luck"] ** 2 * long["trades"] ** 2 + short["luck"] ** 2 * short["trades"] ** 2) / len(SEEDS))
    return "15 minutes" if short["money_proof"] and short["exam_total"] > 0 and short["total"] >= long["total"] - luck else "60 minutes"


def main() -> None:
    d = build()
    cols = [c for c in d.columns if c not in LABELS]
    print(f"{len(d):,} rows, {d['coin_name'].nunique()} coins, {d['t'].min():%Y-%m-%d} to {d['t'].max():%Y-%m-%d}", flush=True)
    results = {kind: judge(d, cols, kind) for kind in KINDS}
    picks = {k: winner(v) for k, v in results.items()}
    for k, name in picks.items():     # the when-to-trade test reads the trades of the version that won
        src = READINGS / f"{k}__{name.split(' (')[0].replace(' ', '_')}.pkl"
        pd.read_pickle(src).to_pickle(READINGS / f"{k}.pkl")
    length = length_choice(results["inzone"][picks["inzone"]], results["inzone_15"][picks["inzone_15"]])
    print("InZone length:", length, flush=True)
    docs = ROOT / "docs" / "intel"
    (docs / "wide.json").write_text(json.dumps({"generated_at": datetime.now(timezone.utc).isoformat(), "picks": picks, "inzone_length": length, "results": results}, indent=1), encoding="utf-8")
    lines = ["# All coins and the long view", "", f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC from {len(d):,} real readings of {d['coin_name'].nunique()} coins, {d['t'].min():%Y-%m-%d} to {d['t'].max():%Y-%m-%d}.",
             "Report only: nothing here changes a model. The rule is at the top of intel/run_wide_contest.py and was fixed before any result was seen. Totals and worst runs are in units of the fixed stake per trade.", ""]
    for kind, res in results.items():
        lines += [f"## {TITLES[kind]}", "", "| Version | Trades | Won | Average | Luck | Total | Worst run | Worst day | Corrected low | Periods up | Usual coins | Exam total | Earns money proof | Result |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|"]
        lines += [f"| {n} | {r['trades']:,.0f} | {r['won']:.2%} | {r['avg']:+.4f} | {r['luck']:.4f} | {r['total']:+.1f} | {r['max_dd']:.1f} | {r['worst_day']:.1f} | {r['low']:+.4f} | {r['periods_up']} of {PERIODS} | {r['usual_total']:+.1f} | {r['exam_total']:+.1f} | {'Yes' if r['money_proof'] else 'No'} | {'**Chosen**' if n == picks[kind] else ''} |" for n, r in res.items()]
        lines.append("")
    lines += [f"InZone length by the owner's rule: **{length}**.", ""]
    (docs / "WIDE.md").write_text("\n".join(lines), encoding="utf-8")
    print("picks:", picks, flush=True)


if __name__ == "__main__":
    main()
