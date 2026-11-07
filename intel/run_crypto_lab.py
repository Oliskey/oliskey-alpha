"""Crypto research, report only: can real market data beat each trade type at the app's REAL payouts?

Data (all real, free): Binance 1-minute and 1-hour candles with taker-buy volume, Binance funding rates, the Fear & Greed
index. News is not used: no free source here has history to test it on, and an untested input cannot have an honest rate.
Every model is walk-forward: each period is predicted only by a model trained on earlier periods.

The pass rule is fixed here before any result is seen, and must not be loosened after reading them:
  1. at least MIN_TRADES separate trades (one at a time per coin);
  2. the average result stays above zero at a confidence corrected for all combinations tried, counting each DAY as one
     sample, because coins move together and thousands of trades in a day are not thousands of independent results;
  3. it still makes money entered one candle late (Fixed Time, InZone) or with costs doubled (Forex);
  4. more than 60% of months are positive;
  5. no single coin supplies more than 70% of the profit.

Writes docs/intel/CRYPTO.md and docs/intel/crypto.json. Usage: python intel/run_crypto_lab.py"""
from __future__ import annotations

import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from statistics import NormalDist

import httpx
import lightgbm as lgb
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine.backtest import wilson_low                  # noqa: E402
from engine.ml import PARAMS, apply_isotonic, fit_isotonic  # noqa: E402
from engine.settings import ROOT, asset_cfg             # noqa: E402
from engine import db                                   # noqa: E402

COINS = {"BTCUSDT": "BTCUSD", "ETHUSDT": "ETHUSD", "SOLUSDT": "SOLUSD", "BNBUSDT": "BNBUSD", "XRPUSDT": "XRPUSD"}
VOLATILITY = {"BTCUSD": 8e-5, "ETHUSD": 8e-5, "SOLUSD": 1e-4, "BNBUSD": 8e-5, "XRPUSD": 1e-4}   # assets.volatility, sets the InZone corridor
PAYOUT_FIXED, PAYOUT_INZONE = 0.80, 1.10   # the app's real crypto payouts (assets table)
FIXED_MINUTES = [5, 15, 60]
INZONE_SECONDS = [60, 300, 900]
FOREX_REWARDS = [1.0, 1.5, 2.0]
MARGIN, MIN_TRADES = 0.01, 500
TESTS = 60 + len(FIXED_MINUTES) + len(INZONE_SECONDS) + len(FOREX_REWARDS)   # includes the 60 combinations already tried
Z = NormalDist().inv_cdf(1 - 0.05 / TESTS)
CACHE = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "oliskey-alpha" / "updown-cache"


def candles(symbol: str) -> pd.DataFrame:
    """The cached year of 1-minute candles, topped up to now; only the missing days are downloaded."""
    z = np.load(CACHE / f"{symbol}_1m.npz")
    df = pd.DataFrame({k: z[k] for k in z.files})
    frm, rows = int(df["t"].iloc[-1]) + 60_000, []
    try:
        with httpx.Client(timeout=20) as c:
            while frm < time.time() * 1000 - 120_000:
                data = c.get("https://api.binance.com/api/v3/klines", params={"symbol": symbol, "interval": "1m", "startTime": frm, "limit": 1000}).raise_for_status().json()
                if not data:
                    break
                rows += [(k[0], float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5]), float(k[9])) for k in data if k[6] < time.time() * 1000]
                frm = data[-1][0] + 60_000
                if len(data) < 1000:
                    break
    except httpx.HTTPError as err:
        print(f"{symbol}: top-up stopped ({type(err).__name__}); using what arrived", flush=True)
    if rows:
        df = pd.concat([df, pd.DataFrame(rows, columns=["t", "o", "h", "l", "c", "v", "tb"])], ignore_index=True).drop_duplicates("t").sort_values("t", ignore_index=True)
        np.savez(CACHE / f"{symbol}_1m.npz", **{k: df[k].to_numpy() for k in df.columns})
    return df


def funding(symbol: str) -> pd.Series:
    """Real funding rates (what crowded traders pay each other), every 8 hours. Empty if the source does not answer."""
    path = CACHE / f"{symbol}_funding.json"
    rows = json.loads(path.read_text()) if path.exists() else []
    frm = rows[-1][0] + 1 if rows else int(datetime(2021, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
    try:
        with httpx.Client(timeout=20) as c:
            while frm < time.time() * 1000:
                data = c.get("https://fapi.binance.com/fapi/v1/fundingRate", params={"symbol": symbol, "startTime": frm, "limit": 1000}).raise_for_status().json()
                if not data:
                    break
                rows += [[d["fundingTime"], float(d["fundingRate"])] for d in data]
                frm = data[-1]["fundingTime"] + 1
                if len(data) < 1000:
                    break
        path.write_text(json.dumps(rows))
    except httpx.HTTPError as err:
        print(f"{symbol}: funding stopped ({type(err).__name__})", flush=True)
    return pd.Series([r[1] for r in rows], index=pd.to_datetime([r[0] for r in rows], unit="ms", utc=True), dtype="float32").sort_index()


def fear_greed() -> pd.Series:
    """Fear & Greed by day. Shifted one day, so a bar only ever sees a value already published."""
    path = CACHE / "fear_greed.json"
    try:
        data = httpx.get("https://api.alternative.me/fng/?limit=0", timeout=20).raise_for_status().json()["data"]
        path.write_text(json.dumps(data))
    except httpx.HTTPError:
        data = json.loads(path.read_text()) if path.exists() else []
    s = pd.Series([float(d["value"]) for d in data], index=pd.to_datetime([int(d["timestamp"]) for d in data], unit="s", utc=True), dtype="float32").sort_index()
    return s.shift(1).dropna()


def ta(df: pd.DataFrame, windows: tuple[int, ...]) -> pd.DataFrame:
    """The standard technical families at a bar's close, from that bar and earlier ones only: momentum, trend, oscillators,
    volatility, volume and order flow."""
    c, h, l, v = df["c"], df["h"], df["l"], df["v"]
    ret = np.log(c).diff()
    f = pd.DataFrame(index=df.index)
    for n in windows:
        f[f"r{n}"] = np.log(c / c.shift(n))
    for n in (20, 50, 200):                                       # moving averages
        f[f"ema{n}"] = c / c.ewm(span=n, adjust=False).mean() - 1
    fast, slow = c.ewm(span=12, adjust=False).mean(), c.ewm(span=26, adjust=False).mean()
    f["macd"] = (fast - slow - (fast - slow).ewm(span=9, adjust=False).mean()) / c
    gain, loss = ret.clip(lower=0).rolling(14).mean(), (-ret.clip(upper=0)).rolling(14).mean()
    f["rsi"] = 100 - 100 / (1 + gain / loss.replace(0, np.nan))
    lo14, hi14 = l.rolling(14).min(), h.rolling(14).max()
    f["stoch"] = (c - lo14) / (hi14 - lo14).replace(0, np.nan)
    ma20, sd20 = c.rolling(20).mean(), c.rolling(20).std()
    f["bb_pos"], f["bb_width"] = (c - ma20) / (2 * sd20).replace(0, np.nan), 4 * sd20 / ma20
    tp = (h + l + c) / 3
    f["cci"] = (tp - tp.rolling(20).mean()) / (0.015 * (tp - tp.rolling(20).mean()).abs().rolling(20).mean()).replace(0, np.nan)
    flow = tp * v
    up = flow.where(tp > tp.shift(), 0).rolling(14).sum()
    down = flow.where(tp < tp.shift(), 0).rolling(14).sum()
    f["mfi"] = 100 - 100 / (1 + up / down.replace(0, np.nan))
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1 / 14, adjust=False).mean()
    f["atr"] = atr / c
    dm_up, dm_dn = (h - h.shift()).clip(lower=0), (l.shift() - l).clip(lower=0)
    di_up = dm_up.where(dm_up > dm_dn, 0).ewm(alpha=1 / 14, adjust=False).mean() / atr.replace(0, np.nan)
    di_dn = dm_dn.where(dm_dn > dm_up, 0).ewm(alpha=1 / 14, adjust=False).mean() / atr.replace(0, np.nan)
    f["di"] = di_up - di_dn
    f["adx"] = ((di_up - di_dn).abs() / (di_up + di_dn).replace(0, np.nan)).ewm(alpha=1 / 14, adjust=False).mean()
    f["vol_short"], f["vol_long"] = ret.rolling(15).std(), ret.rolling(60).std()
    f["vol_ratio"] = v / v.rolling(60).mean().replace(0, np.nan)
    if "tb" in df:
        f["taker"] = (2 * df["tb"] - v) / v.replace(0, np.nan)
        f["taker5"] = (2 * df["tb"].rolling(5).sum() - v.rolling(5).sum()) / v.rolling(5).sum().replace(0, np.nan)
    hi, lo = h.rolling(60).max(), l.rolling(60).min()
    f["range_pos"] = (c - lo) / (hi - lo).replace(0, np.nan)
    return f


def add_context(f: pd.DataFrame, ts: pd.Series, fund: pd.Series, fng: pd.Series) -> pd.DataFrame:
    idx = pd.DatetimeIndex(ts)
    f["funding"] = fund.reindex(idx, method="ffill").to_numpy() if len(fund) else np.nan
    f["fear_greed"] = fng.reindex(idx, method="ffill").to_numpy() if len(fng) else np.nan
    f["hour"], f["weekday"] = idx.hour, idx.weekday
    return f


def fit_predict(train: pd.DataFrame, test: pd.DataFrame, cols: list[str], y: str, max_rows: int = 300_000) -> np.ndarray:
    cut = train["t"].quantile(0.85)
    fit, cal = train[train["t"] < cut - pd.Timedelta(days=1)], train[train["t"] >= cut]
    s = fit.sample(min(len(fit), max_rows), random_state=7)
    model = lgb.train({**PARAMS, "verbose": -1}, lgb.Dataset(s[cols], s[y]), num_boost_round=150)
    return apply_isotonic(fit_isotonic(model.predict(cal[cols]), cal[y].to_numpy()), model.predict(test[cols]))


def one_at_a_time(t: pd.DataFrame, gap: pd.Timedelta) -> pd.DataFrame:
    """A person can only hold one trade per coin at a time."""
    keep = []
    for _, g in t.sort_values("t").groupby("coin"):
        last = None
        for i, when in zip(g.index, g["t"]):
            if last is None or when >= last + gap:
                keep.append(i)
                last = when
    return t.loc[keep]


def verdict(t: pd.DataFrame, harder: float | None, harder_name: str, breakeven: float) -> dict:
    """The pass rule. `t` needs t, coin, r and win; `harder` is the average under the harder condition."""
    n = len(t)
    if n == 0:
        return {"trades": 0, "wins": 0, "passed": False, "failed": ["No trades"], "breakeven": breakeven}
    wins = int(t["win"].sum())
    daily = t.groupby(t["t"].dt.floor("D"))["r"].sum() / max(n / t["t"].dt.floor("D").nunique(), 1)   # one sample per day
    low = float(daily.mean() - Z * daily.std(ddof=1) / math.sqrt(len(daily))) if len(daily) > 1 else -math.inf
    months = t.groupby(t["t"].dt.strftime("%Y-%m"))["r"].mean()
    coins = t.groupby("coin")["r"].sum()
    total = float(coins.sum())
    share = float(coins.max() / total) if total > 0 else 1.0
    checks = [
        (f"At least {MIN_TRADES} separate trades", n >= MIN_TRADES),
        (f"Average result above zero after correcting for {TESTS} combinations, counting each day once", low > 0),
        (f"Still makes money {harder_name}", harder is not None and harder > 0),
        ("More than 60% of months positive", len(months) > 0 and (months > 0).mean() > 0.6),
        ("Profit not from one coin alone", total > 0 and share <= 0.7),
    ]
    return {"trades": n, "wins": wins, "win_rate": wins / n, "low": wilson_low(wins, n), "high": wilson_low(wins, n, -1.96), "breakeven": breakeven,
            "avg": float(t["r"].mean()), "corrected_low": low, "harder": harder, "months_positive": f"{int((months > 0).sum())} of {len(months)}",
            "top_coin_share": share, "passed": all(ok for _, ok in checks), "failed": [c for c, ok in checks if not ok]}


def study_minutes(fng: pd.Series) -> tuple[dict, dict]:
    frames, raw = [], {}
    btc = None
    for i, (sym, asset) in enumerate(COINS.items()):
        df = candles(sym)
        raw[asset] = df
        ts = pd.to_datetime(df["t"], unit="ms", utc=True)
        f = add_context(ta(df, (1, 3, 5, 15, 60, 240, 1440)), ts, funding(sym), fng).astype("float32")
        f["t"], f["coin"], f["c"] = ts, i, df["c"].to_numpy()
        if btc is None:
            btc = f.set_index("t")[["r5", "r15"]].rename(columns={"r5": "btc5", "r15": "btc15"})
        f = f.join(btc, on="t")
        for h in FIXED_MINUTES:
            c = df["c"]
            f[f"y{h}"] = np.where(c.shift(-h) > c, 1, np.where(c.shift(-h) < c, 0, -1)).astype("int8")
            f[f"late{h}"] = np.where(c.shift(-h - 1) > c.shift(-1), 1, np.where(c.shift(-h - 1) < c.shift(-1), 0, -1)).astype("int8")
        frames.append(f.iloc[1500:-70])
        print(f"{asset}: {len(f):,} candles, to {ts.iloc[-1]:%Y-%m-%d %H:%M}", flush=True)
    d = pd.concat(frames, ignore_index=True)
    cols = [c for c in d.columns if c not in ("t", "c") and not c.startswith(("y", "late"))]

    be = 1 / (1 + PAYOUT_FIXED)
    fixed = {}
    for h in FIXED_MINUTES:
        x = d[d[f"y{h}"] >= 0].copy()
        x["month"] = x["t"].dt.strftime("%Y-%m")
        months = sorted(x["month"].unique())
        out = []
        for m in months[3:]:
            test = x[x["month"] == m]
            p = fit_predict(x[x["month"] < m], test, cols, f"y{h}")
            out.append(test[["t", "coin", f"y{h}", f"late{h}"]].assign(p=p))
            print(f"  fixed {h}m {m}: {len(test):,}", flush=True)
        o = pd.concat(out)
        up = o["p"] > 0.5
        o["conf"] = np.where(up, o["p"], 1 - o["p"])
        o["win"] = np.where(up, o[f"y{h}"] == 1, o[f"y{h}"] == 0)
        late_win = np.where(up, o[f"late{h}"] == 1, o[f"late{h}"] == 0)
        late_tie = o[f"late{h}"] < 0
        o["r"] = np.where(o["win"], PAYOUT_FIXED, -1.0)
        o["r_late"] = np.where(late_tie, 0.0, np.where(late_win, PAYOUT_FIXED, -1.0))
        take = one_at_a_time(o[o["conf"] > be + MARGIN], pd.Timedelta(minutes=h))
        fixed[f"{h}m"] = {**verdict(take, float(take["r_late"].mean()) if len(take) else None, "entered one candle late", be),
                          "minutes": h, "took_every_candle_hit": float(o["win"].mean()), "by_confidence": confidence_table(o, be)}
        print(f"  fixed {h}m result: {fixed[f'{h}m']['trades']} trades, {fixed[f'{h}m'].get('win_rate', 0):.2%} vs {be:.2%}", flush=True)

    be = 1 / (1 + PAYOUT_INZONE)
    inzone = {}
    for secs in INZONE_SECONDS:
        h = max(1, secs // 60)
        rows = []
        for i, (asset, df) in enumerate(raw.items()):
            zone = VOLATILITY[asset] * 0.6 * math.sqrt(secs * 4)        # the corridor open_trade really uses
            c = df["c"]
            win = ((c.shift(-h) - c).abs() / c <= zone) & c.shift(-h).notna()
            late = ((c.shift(-h - 1) - c.shift(-1)).abs() / c.shift(-1) <= zone)
            rows.append(pd.DataFrame({"t": pd.to_datetime(df["t"], unit="ms", utc=True), "coin": i, "win": win, "late": late}).iloc[::h])
        t = pd.concat(rows, ignore_index=True)
        t["r"] = np.where(t["win"], PAYOUT_INZONE, -1.0)
        harder = float(np.where(t["late"], PAYOUT_INZONE, -1.0).mean())
        inzone[f"{secs}s"] = {**verdict(t, harder, "entered one candle late", be), "seconds": secs, "zone_btc_pct": VOLATILITY["BTCUSD"] * 0.6 * math.sqrt(secs * 4) * 100}
        print(f"  inzone {secs}s result: {inzone[f'{secs}s']['win_rate']:.2%} vs {be:.2%}", flush=True)
    return fixed, inzone


def confidence_table(o: pd.DataFrame, be: float) -> list[dict]:
    """Does a stronger reading really win more? The honest rate for each band."""
    out = []
    for lo, hi in ((0.5, 0.52), (0.52, 0.54), (0.54, 0.56), (0.56, 0.58), (0.58, 0.6), (0.6, 0.65), (0.65, 1.01)):
        g = o[(o["conf"] > lo) & (o["conf"] <= hi)]
        if len(g):
            out.append({"from": lo, "to": hi, "rows": len(g), "said": float(g["conf"].mean()), "won": float(g["win"].mean())})
    return out


def study_forex(fng: pd.Series) -> dict:
    """1-hour bars, stop 1.5 ATR, target R x the stop, closed after 24 hours, same costs as the engine."""
    frames = []
    for i, (sym, asset) in enumerate(COINS.items()):
        bars = db.load_bars(asset, "1h")
        if len(bars) < 2000:
            continue
        df = pd.DataFrame({"o": bars["open"].to_numpy(), "h": bars["high"].to_numpy(), "l": bars["low"].to_numpy(), "c": bars["close"].to_numpy(), "v": bars["volume"].to_numpy()})
        ts = pd.Series(bars.index, name="t")
        f = add_context(ta(df, (1, 3, 6, 12, 24, 72, 168)), ts, funding(sym), fng).astype("float32")
        f["t"], f["coin"] = ts, i
        cost = asset_cfg(asset, "crypto")["cost_pct"] / 100
        o_, h_, l_, c_, atr = df["o"].to_numpy(), df["h"].to_numpy(), df["l"].to_numpy(), df["c"].to_numpy(), (f["atr"].to_numpy() * df["c"].to_numpy())
        for reward in FOREX_REWARDS:
            for direction, tag in ((1, "u"), (-1, "d")):
                res, cr = np.full(len(df), np.nan), np.full(len(df), np.nan)
                for k in range(300, len(df) - 26):
                    if not atr[k] > 0:
                        continue
                    entry, risk = o_[k + 1], 1.5 * atr[k]
                    stop, target = entry - direction * risk, entry + direction * risk * reward
                    r = None
                    for j in range(k + 1, k + 25):
                        if (l_[j] <= stop) if direction > 0 else (h_[j] >= stop):
                            r = -1.0
                            break
                        if (h_[j] >= target) if direction > 0 else (l_[j] <= target):
                            r = reward
                            break
                    res[k] = r if r is not None else direction * (c_[k + 24] - entry) / risk
                    cr[k] = cost * entry / risk
                f[f"r_{reward:g}{tag}"], f[f"c_{reward:g}{tag}"] = res, cr
        frames.append(f)
        print(f"{asset}: {len(df):,} hourly bars outcomes done", flush=True)
    d = pd.concat(frames, ignore_index=True)
    cols = [c for c in d.columns if c not in ("t",) and not c.startswith(("r_", "c_"))]
    d["q"] = d["t"].dt.to_period("Q").astype(str)
    quarters = sorted(d["q"].unique())
    out = {}
    for reward in FOREX_REWARDS:
        res = []
        for tag, direction in (("u", 1), ("d", -1)):
            r_col, c_col = f"r_{reward:g}{tag}", f"c_{reward:g}{tag}"
            x = d[d[r_col].notna()].copy()
            x["net"] = x[r_col] - x[c_col]
            x["y"] = (x["net"] > 0).astype(int)
            for q in quarters[6:]:
                test = x[x["q"] == q]
                train = x[(x["q"] < q) & (x["t"] < test["t"].min() - pd.Timedelta(days=2))] if len(test) else None
                if train is None or len(train) < 5000:
                    continue
                res.append(pd.DataFrame({"t": test["t"], "coin": test["coin"], "conf": fit_predict(train, test, cols, "y", 150_000), "r": test["net"], "r2": test["net"] - test[c_col], "be": (1 + test[c_col]) / (1 + reward), "dir": direction}))
            print(f"  forex {reward:g}:1 {tag} done", flush=True)
        o = pd.concat(res)
        o["win"] = o["r"] > 0
        o = o.sort_values("conf").groupby(["coin", "t"], as_index=False).tail(1)     # the stronger of Up and Down
        take = one_at_a_time(o[o["conf"] > o["be"] + MARGIN], pd.Timedelta(hours=24))
        be = float(take["be"].mean()) if len(take) else 1 / (1 + reward)
        out[f"{reward:g}:1"] = {**verdict(take, float(take["r2"].mean()) if len(take) else None, "with costs doubled", be), "reward": reward}
        print(f"  forex {reward:g}:1 result: {out[f'{reward:g}:1']['trades']} trades, avg {out[f'{reward:g}:1'].get('avg', 0):+.3f}R", flush=True)
    return out


def load_previous() -> dict:
    """The last saved research results, for comparing with a new run."""
    try:
        return json.loads((ROOT / "docs" / "intel" / "crypto.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def no_lookahead() -> bool:
    df = pd.DataFrame({k: v[:6000] for k, v in np.load(CACHE / "BTCUSDT_1m.npz").items()})
    a = ta(df, (1, 5, 60)).iloc[:4000].fillna(0).to_numpy(float)
    df.loc[4500:, ["o", "h", "l", "c", "v", "tb"]] *= 1.5
    return bool(np.allclose(a, ta(df, (1, 5, 60)).iloc[:4000].fillna(0).to_numpy(float)))


def table(title: str, rows: dict, unit: str) -> list[str]:
    lines = [f"## {title}", "", f"| Version | Trades | Won | 95% range | Needed | Average per {unit} | Corrected low | Harder condition | Months up | Result |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|"]
    for k, r in rows.items():
        if not r["trades"]:
            lines.append(f"| {k} | 0 | - | - | {r['breakeven']:.2%} | - | - | - | - | No trades |")
            continue
        lines.append(f"| {k} | {r['trades']:,} | {r['win_rate']:.2%} | {r['low']:.1%}-{r['high']:.1%} | {r['breakeven']:.2%} | {r['avg']:+.3f} | {r['corrected_low']:+.3f} | {(r['harder'] or 0):+.3f} | {r['months_positive']} | {'**PASSED**' if r['passed'] else 'Not passed'} |")
    lines.append("")
    for k, r in rows.items():
        if r["failed"]:
            lines.append(f"- {k} did not meet: {'; '.join(r['failed'])}.")
    return lines + [""]


def main() -> None:
    started = time.time()
    fng = fear_greed()
    fixed, inzone = study_minutes(fng)
    forex = study_forex(fng)
    clean = no_lookahead()
    out = {"generated_at": datetime.now(timezone.utc).isoformat(), "fixed_time": fixed, "inzone": inzone, "forex": forex, "no_lookahead": clean}
    (ROOT / "docs" / "intel" / "crypto.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    lines = ["# Crypto research", "", f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC from real Binance candles, Binance funding rates and the Fear & Greed index. Report only: nothing here changes what the app shows.", "",
             f"The bar is corrected for {TESTS} combinations (z = {Z:.2f}) and counts each day once. The pass rule was fixed in code before these results were seen.",
             f"Future prices check: {'no differences, features do not see later prices' if clean else '**DIFFERENCES FOUND**'}.", ""]
    lines += table(f"Fixed Time at the app's real +{PAYOUT_FIXED:.0%} payout", fixed, "α1")
    lines += ["### Does a stronger reading win more?", "", "| Version | Model said | Candles | Average said | Really won |", "|---|---|---:|---:|---:|"]
    for k, r in fixed.items():
        lines += [f"| {k} | {b['from']:.0%}-{b['to']:.0%} | {b['rows']:,} | {b['said']:.1%} | {b['won']:.1%} |" for b in r["by_confidence"]]
    lines += ["", *table(f"InZone at the app's real +{PAYOUT_INZONE:.0%} payout, using the app's real corridor, no model", inzone, "α1")]
    lines += table("Forex on 1-hour bars (stop 1.5 ATR, closed after 24 hours)", forex, "1R risked")
    lines += ["**What this cannot show.** Test results can flatter a method. Only live results are truly unseen. News is not included because no free source here has history to test it on.", "", f"Run time {time.time() - started:.0f} s."]
    (ROOT / "docs" / "intel" / "CRYPTO.md").write_text("\n".join(lines), encoding="utf-8")
    print("wrote docs/intel/CRYPTO.md", flush=True)


if __name__ == "__main__":
    main()
