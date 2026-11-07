"""Training contest on real data. Downloads about 3 years of real 1-minute candles, trains stronger model versions, and judges each
on three separate 3-month periods it never trained on. A new version replaces the current one only if it clearly earns more
there, with the same rule as the research. Training harder that only memorises the past loses this contest.

Writes docs/intel/TRAINING.md and intel/models/training.json (read by the daily retrain). Usage: python intel/run_train_hard.py"""
from __future__ import annotations

import json
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from statistics import NormalDist

import httpx
import lightgbm as lgb
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_crypto_lab as lab                                      # noqa: E402
from engine.ml import PARAMS, apply_isotonic, fit_isotonic        # noqa: E402
from engine.settings import INTEL, ROOT                           # noqa: E402
from engine.updown import _frame, _sigma, BREAKEVEN, ISO_MIN_ROWS, IZ_BREAKEVEN, IZ_PAYOUT, IZ_Q, PAYOUT   # noqa: E402

YEARS, MINUTES = 3, 60
PERIODS, PERIOD_DAYS = 3, 91     # three separate 3-month test periods
STEP = 5
LONG = lab.CACHE / "long"
VERSIONS = {
    "current (1 year, 150 rounds)": {"days": 365, "rounds": 150, "lr": None, "rows": 300_000},
    "3 years, 150 rounds": {"days": 99999, "rounds": 150, "lr": None, "rows": 600_000},
    "3 years, 500 slower rounds": {"days": 99999, "rounds": 500, "lr": 0.02, "rows": 900_000},
    "1 year, 500 slower rounds": {"days": 365, "rounds": 500, "lr": 0.02, "rows": 600_000},
    "3 years, blend of 3 models": {"days": 99999, "rounds": 150, "lr": None, "rows": 400_000, "blend": 3},
}
SEEDS = (7, 21, 42)   # each version trains several times: the same version can score very differently by training luck alone
MIN_GAIN = 0.005      # must beat the current version's average by at least this, per unit risked, and by more than its training luck
TRIED = lab.TESTS + 2 * len(VERSIONS)
Z = NormalDist().inv_cdf(1 - 0.05 / TRIED)


def download(symbol: str) -> pd.DataFrame:
    """Older candles are added before the cached year, saving as it goes so a broken connection loses little."""
    LONG.mkdir(exist_ok=True)
    path = LONG / f"{symbol}.npz"
    base = lab.candles(symbol)
    if path.exists():
        z = np.load(path)
        old = pd.DataFrame({k: z[k] for k in z.files})
        base = pd.concat([old, base], ignore_index=True).drop_duplicates("t").sort_values("t", ignore_index=True)
    start = int(time.time() * 1000) - YEARS * 365 * 86_400_000
    end, rows, failures = int(base["t"].iat[0]) - 1, [], 0
    with httpx.Client(timeout=20) as c:
        while end > start and failures < 25:
            try:
                data = c.get("https://api.binance.com/api/v3/klines", params={"symbol": symbol, "interval": "1m", "endTime": end, "limit": 1000}).raise_for_status().json()
            except httpx.HTTPError:
                failures += 1
                time.sleep(2 + failures)
                continue
            if not data:
                break
            failures = 0
            rows = [(k[0], float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5]), float(k[9])) for k in data] + rows
            end = data[0][0] - 1
            if len(rows) >= 100_000:
                base = pd.concat([pd.DataFrame(rows, columns=base.columns), base], ignore_index=True).sort_values("t", ignore_index=True)
                np.savez(path, **{k: base[k].to_numpy() for k in base.columns})
                rows = []
                print(f"{symbol}: back to {pd.to_datetime(base['t'].iat[0], unit='ms'):%Y-%m-%d}", flush=True)
    if rows:
        base = pd.concat([pd.DataFrame(rows, columns=base.columns), base], ignore_index=True).sort_values("t", ignore_index=True)
    np.savez(path, **{k: base[k].to_numpy() for k in base.columns})
    print(f"{symbol}: {len(base):,} candles from {pd.to_datetime(base['t'].iat[0], unit='ms'):%Y-%m-%d}", flush=True)
    return base


def build() -> pd.DataFrame:
    with ThreadPoolExecutor(5) as pool:
        raw = dict(zip(lab.COINS, pool.map(download, lab.COINS)))
    fng = lab.fear_greed()
    frames, btc = [], None
    for i, sym in enumerate(lab.COINS):
        df = raw[sym]
        f = _frame(df, i, lab.funding(sym), fng)
        if btc is None:
            btc = f.set_index("t")[["r5", "r15"]].rename(columns={"r5": "btc5", "r15": "btc15"})
        f = f.join(btc, on="t")
        c = df["c"]
        f["y_ft"] = np.where(c.shift(-MINUTES) > c, 1, np.where(c.shift(-MINUTES) < c, 0, -1)).astype("int8")
        f["y_iz"] = (np.log(c.shift(-MINUTES) / c).abs() <= IZ_Q * _sigma(c) * np.sqrt(MINUTES)).astype("int8")
        # Every 5th minute: the answers span 60 minutes, so neighbours add little, and this needs a fifth of the memory.
        frames.append(f.iloc[1500:-MINUTES - 10].iloc[::STEP].copy())
        del f
        print(f"features {sym}", flush=True)
    return pd.concat(frames, ignore_index=True)


def _train_one(train: pd.DataFrame, test: pd.DataFrame, cols: list[str], y: str, v: dict, seed: int = 7) -> np.ndarray:
    split = train["t"].quantile(0.85)
    fit, cal = train[train["t"] < split - pd.Timedelta(days=1)], train[train["t"] >= split]
    preds = []
    for s_id in range(seed, seed + v.get("blend", 1)):      # a blend of several models averages out each one's accidents
        s = fit.sample(min(len(fit), v["rows"]), random_state=s_id)
        params = {**PARAMS, "verbose": -1, "seed": s_id, **({"learning_rate": v["lr"]} if v["lr"] else {})}
        model = lgb.train(params, lgb.Dataset(s[cols], s[y]), num_boost_round=v["rounds"])
        preds.append((model.predict(cal[cols]), model.predict(test[cols])))
    iso = fit_isotonic(np.mean([a for a, _ in preds], axis=0), cal[y].to_numpy(), ISO_MIN_ROWS)
    return apply_isotonic(iso, np.mean([b for _, b in preds], axis=0))


def contest(d: pd.DataFrame, y: str, cols: list[str], payout: float, breakeven: float, directional: bool) -> dict:
    """Each version is judged on separate periods it never trained on, each with a gap so no answer can leak across."""
    x = d[d[y] >= 0]
    last, gap = x["t"].max(), pd.Timedelta(minutes=MINUTES + 60)
    out = {}
    for name, v in VERSIONS.items():
        runs = []
        for seed in SEEDS:
            taken, by_period = [], []
            for k in range(PERIODS):
                hi = last - pd.Timedelta(days=PERIOD_DAYS * k)
                lo = hi - pd.Timedelta(days=PERIOD_DAYS)
                test = x[(x["t"] >= lo) & (x["t"] < hi)]
                train = x[(x["t"] < lo - gap) & (x["t"] >= lo - pd.Timedelta(days=v["days"]))]
                if len(train) < 50_000 or test.empty:
                    continue
                t = test[["t", "coin"]].assign(y=test[y].to_numpy(), p=_train_one(train, test, cols, y, v, seed))
                if directional:
                    up = t["p"] > 0.5
                    t["conf"] = np.where(up, t["p"], 1 - t["p"])
                    t["win"] = np.where(up, t["y"] == 1, t["y"] == 0)
                else:
                    t["up"] = True
                    t["conf"], t["win"] = t["p"], t["y"] == 1
                if directional:
                    t["up"] = up
                t["r"] = np.where(t["win"], payout, -1.0)
                take = lab.one_at_a_time(t[t["conf"] > breakeven + lab.MARGIN], pd.Timedelta(minutes=MINUTES))
                taken.append(take)
                by_period.append(float(take["r"].sum()) if len(take) else 0.0)
            runs.append(score(pd.concat(taken) if taken else pd.DataFrame(columns=["t", "coin", "r", "win", "up"]), by_period))
        out[name] = {k: float(np.mean([r[k] for r in runs])) for k in runs[0] if k != "periods"}
        out[name]["periods"] = [float(a) for a in np.mean([r["periods"] for r in runs], axis=0)] if runs[0]["periods"] else []
        out[name]["periods_up"] = sum(1 for a in out[name]["periods"] if a > 0)
        out[name]["luck"] = float(np.std([r["avg"] for r in runs], ddof=1))   # how far the average moved from training luck alone
        r = out[name]
        print(f"  {y} {name}: {r['trades']:.0f} trades, won {r['won']:.2%}, avg {r['avg']:+.4f} (luck {r['luck']:.4f}), total {r['total']:+.1f}, worst run {r['max_dd']:.1f}, corrected low {r['low']:+.4f}, by period {[round(a, 1) for a in r['periods']]}, up {r['up_share']:.0%}, top coin {r['top_coin']:.0%}", flush=True)
    return out


def score(take: pd.DataFrame, by_period: list[float]) -> dict:
    """One training run. Daily results count each day once, as the research's pass rule does. Money is at a fixed stake per trade."""
    n = len(take)
    if not n:
        return {"trades": 0, "won": 0.0, "avg": 0.0, "total": 0.0, "max_dd": 0.0, "worst_day": 0.0, "low": -9.0, "up_share": 0.0, "top_coin": 1.0, "periods": by_period}
    s = take.sort_values("t")
    days = s["t"].dt.floor("D")
    daily = s.groupby(days)["r"].sum() / max(n / days.nunique(), 1)
    curve = s["r"].cumsum()
    coins = s.groupby("coin")["r"].sum()
    total = float(coins.sum())
    return {"trades": n, "won": float(s["win"].mean()), "avg": float(s["r"].mean()), "total": total, "max_dd": float((curve.cummax().clip(lower=0) - curve).max()),
            "worst_day": float(s.groupby(days)["r"].sum().min()), "low": float(daily.mean() - Z * daily.std(ddof=1) / math.sqrt(len(daily))) if len(daily) > 1 else -9.0,
            "up_share": float(s["up"].mean()), "top_coin": float(coins.max() / total) if total > 0 else 1.0, "periods": by_period}


def winner(results: dict) -> str:
    """The current version stays unless another earns clearly more per trade than training luck explains, and more in total, on enough
    trades, in as many periods, with no worse lower bound. Earning more per trade while earning less overall does not win."""
    base_name = next(iter(VERSIONS))
    base, best = results[base_name], base_name
    for name, r in results.items():
        need = max(MIN_GAIN, 2 * math.sqrt((r["luck"] ** 2 + base["luck"] ** 2) / len(SEEDS)))
        if name != base_name and r["trades"] >= 500 and r["avg"] >= base["avg"] + need and r["total"] >= base["total"] and r["low"] >= base["low"] and r["periods_up"] >= base["periods_up"] and r["total"] > results[best]["total"]:
            best = name
    return best


def main() -> None:
    d = build()
    cols = [c for c in d.columns if c not in ("t", "y_ft", "y_iz")]
    print(f"{len(d):,} rows, {d['t'].min():%Y-%m-%d} to {d['t'].max():%Y-%m-%d}", flush=True)
    ft = contest(d, "y_ft", cols, PAYOUT, BREAKEVEN, True)
    iz = contest(d, "y_iz", cols, IZ_PAYOUT, IZ_BREAKEVEN, False)
    picks = {"fixed_time": winner(ft), "inzone": winner(iz)}
    saved = {k: {**VERSIONS[v], "name": v} for k, v in picks.items()}
    (INTEL / "models" / "training.json").write_text(json.dumps({"generated_at": datetime.now(timezone.utc).isoformat(), "picks": saved}, indent=1), encoding="utf-8")
    lines = ["# Training contest", "", f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC from {len(d):,} real 1-minute readings, {d['t'].min():%Y-%m-%d} to {d['t'].max():%Y-%m-%d}.",
             f"Each version trained {len(SEEDS)} times and was judged on the average, on {PERIODS} separate {PERIOD_DAYS}-day periods it never trained on, with a gap around each. A new version replaces the current one only if it earns more per unit risked than training luck explains (and at least {MIN_GAIN}) and more in total, on 500+ trades, in as many periods, with no worse lower bound.",
             f"Totals and worst losing runs are in units of the fixed stake per trade. The lower bound counts each day once and is corrected for {TRIED} combinations tried. Past periods helped design this contest, so only live results are truly unseen.", ""]
    for title, res, be, pick in (("Fixed Time, 60 minutes", ft, BREAKEVEN, picks["fixed_time"]), ("InZone, 60 minutes", iz, IZ_BREAKEVEN, picks["inzone"])):
        lines += [f"## {title} (needs {be:.2%})", "", "| Version | Trades | Won | Average | Training luck | Total | Worst run | Worst day | Corrected low | Periods up | Up share | Top coin | Result |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|"]
        lines += [f"| {n} | {r['trades']:,.0f} | {r['won']:.2%} | {r['avg']:+.4f} | {r['luck']:.4f} | {r['total']:+.1f} | {r['max_dd']:.1f} | {r['worst_day']:.1f} | {r['low']:+.4f} | {r['periods_up']} of {PERIODS} | {r['up_share']:.0%} | {r['top_coin']:.0%} | {'**Chosen**' if n == pick else ''} |" for n, r in res.items()]
        lines.append("")
    (ROOT / "docs" / "intel" / "TRAINING.md").write_text("\n".join(lines), encoding="utf-8")
    print("picks:", picks, flush=True)


if __name__ == "__main__":
    main()
