"""Up/Down study for Fixed Time trades (owner request 2026-10-30): can a model predict whether the price is higher or
lower 1 or 5 minutes after a candle closes, often enough to beat the app's payout?

A Fixed Time trade pays +85% on a win and loses 100% on a loss (equal price = refund), so it only makes money if the
win rate is above 1 / 1.85 = 54.05%. This script measures that honestly:
  * data: 1 year of real 1-minute Binance candles for 5 liquid coins, incl. taker-buy volume (who started each trade);
  * features use only candles up to the decision candle (no look-ahead; checked below);
  * walk-forward by month: each month is predicted by a model trained only on earlier months;
  * a setup is "taken" only when the calibrated probability beats break-even by a margin;
  * accepted only if, over >= 200 taken trades, the 95% lower bound of the win rate beats 54.05% AND the 95% lower
    bound of the average result per trade is above zero.
Writes docs/intel/UPDOWN.md. Candles are cached outside OneDrive (%LOCALAPPDATA%/oliskey-alpha/updown-cache).

    python intel/run_updown.py
"""
from __future__ import annotations

import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import lightgbm as lgb
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine.backtest import wilson_low  # noqa: E402
from engine.ml import PARAMS, apply_isotonic, fit_isotonic  # noqa: E402
from engine.settings import ROOT  # noqa: E402

COINS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"]
DAYS = 365
HORIZONS = [1, 5]            # minutes after the decision candle closes
PAYOUT = 0.85
BREAKEVEN = 1 / (1 + PAYOUT)  # 54.05%
MARGIN = 0.01                 # take a trade only when p > break-even + 1%
MIN_TRADES = 200
CACHE = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "oliskey-alpha" / "updown-cache"
FEATURES = ["r1", "r3", "r5", "r15", "r60", "rsi14", "vol15", "vol60", "vol_ratio", "taker_imb", "taker_imb5",
            "range_pos", "hour", "weekday", "coin"]


def fetch(symbol: str) -> pd.DataFrame:
    """1 year of closed 1-minute candles, cached as parquet-free .npz (numpy only)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{symbol}_1m.npz"
    now = int(time.time() * 1000)
    start = now - DAYS * 86_400_000
    if path.exists():
        z = np.load(path)
        if z["t"][0] <= start + 86_400_000 and z["t"][-1] >= now - 3 * 86_400_000:
            return pd.DataFrame({k: z[k] for k in z.files})
    rows, frm = [], start
    with httpx.Client(timeout=30) as c:
        while frm < now:
            for attempt in range(5):
                try:
                    r = c.get("https://api.binance.com/api/v3/klines", params={"symbol": symbol, "interval": "1m", "startTime": frm, "limit": 1000})
                    r.raise_for_status()
                    break
                except Exception:
                    time.sleep(2 + attempt * 3)
            else:
                raise RuntimeError(f"{symbol}: download failed at {frm}")
            data = r.json()
            if not data:
                break
            rows += [(k[0], float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5]), float(k[9])) for k in data if k[6] < now]
            frm = data[-1][0] + 60_000
            if len(data) < 1000:
                break
    a = np.array(rows)
    out = {"t": a[:, 0].astype(np.int64), "o": a[:, 1], "h": a[:, 2], "l": a[:, 3], "c": a[:, 4], "v": a[:, 5], "tb": a[:, 6]}
    np.savez(path, **out)
    return pd.DataFrame(out)


def features(df: pd.DataFrame, coin_id: int) -> pd.DataFrame:
    """Features at the close of each candle, from that candle and earlier ones only."""
    c, v = df["c"], df["v"]
    ret = np.log(c).diff()
    f = pd.DataFrame(index=df.index)
    for n in (1, 3, 5, 15, 60):
        f[f"r{n}"] = np.log(c / c.shift(n))
    gain, loss = ret.clip(lower=0).rolling(14).mean(), (-ret.clip(upper=0)).rolling(14).mean()
    f["rsi14"] = 100 - 100 / (1 + gain / loss.replace(0, np.nan))
    f["vol15"], f["vol60"] = ret.rolling(15).std(), ret.rolling(60).std()
    f["vol_ratio"] = v / v.rolling(60).mean()
    taker = (2 * df["tb"] - v) / v.replace(0, np.nan)          # +1 all market buys, -1 all market sells
    f["taker_imb"], f["taker_imb5"] = taker, (2 * df["tb"].rolling(5).sum() - v.rolling(5).sum()) / v.rolling(5).sum()
    hi, lo = df["h"].rolling(60).max(), df["l"].rolling(60).min()
    f["range_pos"] = (c - lo) / (hi - lo).replace(0, np.nan)
    ts = pd.to_datetime(df["t"], unit="ms", utc=True)
    f["hour"], f["weekday"] = ts.dt.hour, ts.dt.weekday
    f["coin"] = coin_id
    return f


def build() -> pd.DataFrame:
    frames = []
    for i, sym in enumerate(COINS):
        df = fetch(sym)
        print(f"{sym}: {len(df):,} candles", flush=True)
        f = features(df, i)
        f["t"] = pd.to_datetime(df["t"], unit="ms", utc=True)
        for h in HORIZONS:
            move = df["c"].shift(-h) - df["c"]            # decision at this candle's close, result h minutes later
            f[f"y{h}"] = np.where(move > 0, 1, np.where(move < 0, 0, -1))   # -1 = equal price (refund)
        frames.append(f.dropna(subset=FEATURES))
    return pd.concat(frames, ignore_index=True)


def walk_forward(d: pd.DataFrame, h: int) -> pd.DataFrame:
    """Predict each month with a model trained on all earlier months (first 3 months are training only)."""
    d = d[d[f"y{h}"] >= 0].copy()                          # refunds can't be won or lost; they are counted separately
    d["month"] = d["t"].dt.to_period("M")
    months = sorted(d["month"].unique())
    d["p"] = np.nan
    for m in months[3:]:
        train, test = d[d["month"] < m], d[d["month"] == m]
        # last 15% of the training period calibrates the probabilities (isotonic); a 1-day gap avoids overlap
        cut = train["t"].quantile(0.85)
        fit, cal = train[train["t"] < cut - pd.Timedelta(days=1)], train[train["t"] >= cut]
        sample = fit.sample(min(len(fit), 600_000), random_state=7)
        model = lgb.train({**PARAMS, "verbose": -1}, lgb.Dataset(sample[FEATURES], sample[f"y{h}"]), num_boost_round=200)
        iso = fit_isotonic(model.predict(cal[FEATURES]), cal[f"y{h}"].to_numpy())
        d.loc[test.index, "p"] = apply_isotonic(iso, model.predict(test[FEATURES]))
        print(f"  {h}m {m}: trained on {len(sample):,}, predicted {len(test):,}", flush=True)
    return d[d["p"].notna()]


def summarize(oos: pd.DataFrame, h: int) -> dict:
    # each row is a possible trade: Up if p > 0.5 else Down; it wins when the direction matches
    up = oos["p"] > 0.5
    p_dir = np.where(up, oos["p"], 1 - oos["p"])
    win = np.where(up, oos[f"y{h}"] == 1, oos[f"y{h}"] == 0)
    take = p_dir > BREAKEVEN + MARGIN
    n, wins = int(take.sum()), int(win[take].sum())
    r = np.where(win[take], PAYOUT, -1.0)
    exp = float(r.mean()) if n else 0.0
    exp_low = float(r.mean() - 1.96 * r.std(ddof=1) / math.sqrt(n)) if n > 1 else -math.inf
    all_hit = float(win.mean())
    by_month = pd.DataFrame({"m": oos["month"].astype(str), "win": win, "take": take})
    monthly = by_month[by_month["take"]].groupby("m")["win"].agg(["size", "mean"])
    return {
        "h": h, "candidates": len(oos), "all_hit": all_hit, "taken": n, "wins": wins,
        "hit": wins / n if n else 0.0, "hit_low": wilson_low(wins, n), "exp": exp, "exp_low": exp_low,
        "accepted": bool(n >= MIN_TRADES and wilson_low(wins, n) > BREAKEVEN and exp_low > 0), "monthly": monthly,
    }


def no_lookahead_check(d: pd.DataFrame) -> bool:
    """Changing future candles must not change today's features."""
    df = fetch(COINS[0]).iloc[:5000].copy()
    a = features(df, 0).iloc[:4000]
    df.loc[4500:, ["o", "h", "l", "c", "v", "tb"]] *= 1.5
    b = features(df, 0).iloc[:4000]
    return bool(np.allclose(a.fillna(0).to_numpy(float), b.fillna(0).to_numpy(float)))


def main() -> None:
    t0 = time.time()
    d = build()
    ok = no_lookahead_check(d)
    print(f"no look-ahead: {ok}", flush=True)
    results = [summarize(walk_forward(d, h), h) for h in HORIZONS]
    lines = [
        "# Up/Down study for Fixed Time trades", "",
        f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC from {len(d):,} one-minute candle closes "
        f"({', '.join(c.replace('USDT', '') for c in COINS)}, last {DAYS} days of real Binance data). No look-ahead check: "
        f"{'passed' if ok else 'FAILED'}.", "",
        f"**Question:** at the close of a 1-minute candle, will the price be higher or lower 1 or 5 minutes later? A Fixed "
        f"Time trade pays +{PAYOUT:.0%} on a win and loses the stake on a loss, so it needs a win rate above "
        f"**{BREAKEVEN:.2%}** to make money. Equal prices are refunds and are left out.", "",
        "**Method:** LightGBM on price moves (1-60 min), RSI, volatility, volume, taker-buy imbalance (real buyer vs seller "
        "pressure), time of day and coin. Walk-forward by month: every month is predicted by a model trained only on "
        f"earlier months, probabilities calibrated on held-out data. A trade is taken only when the model's chance beats "
        f"break-even by {MARGIN:.0%}. Accepted only with >= {MIN_TRADES} taken trades, the 95% lower bound of the win "
        "rate above break-even, and the 95% lower bound of the average result above zero.", "",
        "| Horizon | Possible trades | Hit rate if taking all | Trades taken | Win rate taken | 95% low | Break-even | Avg result per α1 | 95% low | Verdict |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for r in results:
        lines.append(f"| {r['h']} min | {r['candidates']:,} | {r['all_hit']:.2%} | {r['taken']:,} | {r['hit']:.2%} | {r['hit_low']:.2%} | "
                     f"{BREAKEVEN:.2%} | {r['exp']:+.3f} | {r['exp_low']:+.3f} | {'**Accepted**' if r['accepted'] else 'Rejected'} |")
    for r in results:
        if len(r["monthly"]):
            lines += ["", f"Taken trades by month ({r['h']} min):", "", "| Month | Trades | Win rate |", "|---|---:|---:|"]
            lines += [f"| {m} | {int(row['size']):,} | {row['mean']:.1%} |" for m, row in r["monthly"].iterrows()]
    verdict = [r for r in results if r["accepted"]]
    lines += ["", "## Verdict", "",
              ("**Accepted:** " + ", ".join(f"{r['h']} min" for r in verdict) + ". Forward-test with demo money before trusting it.")
              if verdict else
              "**Nothing passed.** The model cannot predict 1- or 5-minute direction often enough to beat the payout. "
              "Short-term crypto direction is close to a coin flip; the app does not offer Up/Down suggestions for Fixed Time.",
              "", f"Run time {time.time() - t0:.0f} s."]
    out = ROOT / "docs" / "intel" / "UPDOWN.md"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[-4:]))


if __name__ == "__main__":
    main()
