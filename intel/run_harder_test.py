"""Harder tests of the versions that won the training contest. Report only: writes docs/intel/HARDER.md and harder.json, and changes no model.

The rules are fixed here, before any result is seen, and are not to be loosened after looking at results.
  A. Late entry. Live trades open up to about 2 minutes after the reading. Entering LATE_MINUTES late, the trade type must still
     earn: average above zero and total above zero.
  B. Coins it never saw. The model trains on the 5 usual coins and is judged on 5 others, over the same periods. It must earn an
     average above zero and a positive total in at least 2 of the 3 periods. The usual coins were picked today because they did
     well, so passing only on them proves little. Delisted coins are left out: the test periods are recent, so they have no data.
  C. Real-market cost. For information: Fixed Time's average move in its favour, against 0.25% to trade on a real exchange. The
     app settles at its own price, so this does not affect demo trades.
A trade type that fails A or B is "doubtful" and the report says so. Usage: python intel/run_harder_test.py"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_train_hard as rt                                                             # noqa: E402
from engine.settings import INTEL, ROOT                                                 # noqa: E402
from engine.updown import _frame, _sigma, BREAKEVEN, IZ_BREAKEVEN, IZ_PAYOUT, IZ_Q, PAYOUT   # noqa: E402

lab = rt.lab
LATE_MINUTES = 2
UNSEEN = ("ADAUSDT", "DOGEUSDT", "LTCUSDT", "LINKUSDT", "AVAXUSDT")
UNSEEN_DAYS = rt.PERIODS * rt.PERIOD_DAYS + 10
REAL_COST = 0.25   # %
LABELS = ("t", "y_ft", "y_iz", "y_ft_late", "y_iz_late", "move")
KINDS = {"fixed_time": ("y_ft", PAYOUT, BREAKEVEN, True), "inzone": ("y_iz", IZ_PAYOUT, IZ_BREAKEVEN, False)}


def recent(symbol: str) -> pd.DataFrame:
    """Real 1-minute candles of a coin outside the usual five, saved as it goes."""
    folder = lab.CACHE / "unseen"
    folder.mkdir(exist_ok=True)
    path = folder / f"{symbol}.npz"
    start = int(time.time() * 1000) - UNSEEN_DAYS * 86_400_000
    now = int(time.time() * 1000)
    cols = ["t", "o", "h", "l", "c", "v", "tb"]
    if path.exists():
        z = np.load(path)
        old = pd.DataFrame({k: z[k] for k in z.files})
        begin = int(old["t"].iat[-1]) + 60_000
    else:
        old, begin = pd.DataFrame(columns=cols), start
    rows, failures = [], 0
    with httpx.Client(timeout=20) as c:
        while begin < now and failures < 25:
            try:
                data = c.get("https://api.binance.com/api/v3/klines", params={"symbol": symbol, "interval": "1m", "startTime": begin, "limit": 1000}).raise_for_status().json()
            except httpx.HTTPError:
                failures += 1
                time.sleep(2 + failures)
                continue
            if not data:
                break
            failures = 0
            rows += [(k[0], float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5]), float(k[9])) for k in data if k[6] < now]
            begin = data[-1][0] + 60_000
    df = pd.concat([old, pd.DataFrame(rows, columns=cols)], ignore_index=True).astype(float).drop_duplicates("t").sort_values("t", ignore_index=True)
    np.savez(path, **{k: df[k].to_numpy() for k in df.columns})
    print(f"{symbol}: {len(df):,} candles", flush=True)
    return df


def labelled(df: pd.DataFrame, coin: float, sym: str, fng: pd.Series, btc: pd.DataFrame | None) -> tuple[pd.DataFrame, pd.DataFrame]:
    m, late = rt.MINUTES, LATE_MINUTES
    f = _frame(df, 0, lab.funding(sym), fng)
    f["coin"] = coin
    if btc is None:
        btc = f.set_index("t")[["r5", "r15"]].rename(columns={"r5": "btc5", "r15": "btc15"})
    f = f.join(btc, on="t")
    c, sigma = df["c"], _sigma(df["c"])
    f["y_ft"] = np.where(c.shift(-m) > c, 1, np.where(c.shift(-m) < c, 0, -1)).astype("int8")
    f["y_iz"] = (np.log(c.shift(-m) / c).abs() <= IZ_Q * sigma * np.sqrt(m)).astype("int8")
    a, b = c.shift(-late), c.shift(-m - late)
    f["y_ft_late"] = np.where(b > a, 1, np.where(b < a, 0, -1)).astype("int8")
    f["y_iz_late"] = (np.log(b / a).abs() <= IZ_Q * sigma.shift(-late) * np.sqrt(m)).astype("int8")
    f["move"] = (np.log(c.shift(-m) / c) * 100).astype("float32")
    return f.iloc[1500:-m - late - 10].iloc[::rt.STEP].copy(), btc


def build(fng: pd.Series) -> tuple[pd.DataFrame, pd.DataFrame]:
    with rt.ThreadPoolExecutor(5) as pool:
        raw = dict(zip(lab.COINS, pool.map(rt.download, lab.COINS)))
    frames, btc = [], None
    for i, sym in enumerate(lab.COINS):
        f, btc = labelled(raw.pop(sym), float(i), sym, fng, btc)
        frames.append(f)
    other = []
    for sym in UNSEEN:
        f, _ = labelled(recent(sym), np.nan, sym, fng, btc)   # no coin number: the model has never met it
        other.append(f.assign(unseen=sym))
    return pd.concat(frames, ignore_index=True), pd.concat(other, ignore_index=True)


def taken(t: pd.DataFrame, p: np.ndarray, y: str, payout: float, be: float, directional: bool) -> pd.DataFrame:
    x = t[["t", "coin", "move"]].assign(y=t[y].to_numpy(), p=p)
    if "unseen" in t:
        x["coin"] = t["unseen"].to_numpy()
    if directional:
        up = x["p"] > 0.5
        x["conf"] = np.where(up, x["p"], 1 - x["p"])
        x["win"] = np.where(up, x["y"] == 1, x["y"] == 0)
        x["up"] = up
        x["signed"] = np.where(up, x["move"], -x["move"])
    else:
        x["conf"], x["win"], x["up"], x["signed"] = x["p"], x["y"] == 1, True, 0.0
    x["r"] = np.where(x["win"], payout, -1.0)
    x = x[(x["conf"] > be + lab.MARGIN) & (x["y"] >= 0)]
    return lab.one_at_a_time(x, pd.Timedelta(minutes=rt.MINUTES))


def run(d: pd.DataFrame, other: pd.DataFrame, cols: list[str], kind: str, v: dict) -> dict:
    y, payout, be, directional = KINDS[kind]
    x = d[d[y] >= 0]
    last, gap = x["t"].max(), pd.Timedelta(minutes=rt.MINUTES + 60)
    out: dict[str, list] = {"as_tested": [], "late": [], "unseen": []}
    moves = []
    for seed in rt.SEEDS:
        per = {k: ([], []) for k in out}
        for k in range(rt.PERIODS):
            hi = last - pd.Timedelta(days=rt.PERIOD_DAYS * k)
            lo = hi - pd.Timedelta(days=rt.PERIOD_DAYS)
            test = x[(x["t"] >= lo) & (x["t"] < hi)]
            train = x[(x["t"] < lo - gap) & (x["t"] >= lo - pd.Timedelta(days=v["days"]))]
            far = other[(other["t"] >= lo) & (other["t"] < hi)]
            if not len(far):
                continue
            both = pd.concat([test[cols], far[cols]], ignore_index=True)
            p = rt._train_one(train, both, cols, y, v, seed)
            pt, pf = p[:len(test)], p[len(test):]
            for name, frame, pr, label in (("as_tested", test, pt, y), ("late", test, pt, f"{y}_late"), ("unseen", far, pf, y)):
                take = taken(frame, pr, label, payout, be, directional)
                per[name][0].append(take)
                per[name][1].append(float(take["r"].sum()) if len(take) else 0.0)
        for name in out:
            take = pd.concat(per[name][0])
            out[name].append(rt.score(take, per[name][1]))
            if name == "as_tested" and directional and len(take):
                moves.append(float(take["signed"].mean()))
    res = {}
    for name, runs in out.items():
        res[name] = {k: float(np.mean([r[k] for r in runs])) for k in runs[0] if k != "periods"}
        res[name]["periods"] = [float(a) for a in np.mean([r["periods"] for r in runs], axis=0)]
        res[name]["luck"] = float(np.std([r["avg"] for r in runs], ddof=1))
    late, far = res["late"], res["unseen"]
    res["pass_late"] = late["avg"] > 0 and late["total"] > 0
    res["pass_unseen"] = far["avg"] > 0 and sum(1 for a in far["periods"] if a > 0) >= 2
    res["move"] = float(np.mean(moves)) if moves else None
    print(kind, json.dumps(res), flush=True)
    return res


def main() -> None:
    d, other = build(lab.fear_greed())
    cols = [c for c in d.columns if c not in LABELS]
    picks = json.loads((INTEL / "models" / "training.json").read_text(encoding="utf-8"))["picks"]
    results = {kind: {"version": picks[kind]["name"], **run(d, other, cols, kind, picks[kind])} for kind in KINDS}
    docs = ROOT / "docs" / "intel"
    (docs / "harder.json").write_text(json.dumps({"generated_at": datetime.now(timezone.utc).isoformat(), "results": results}, indent=1), encoding="utf-8")
    lines = ["# Harder tests", "", f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC. Report only: nothing here changes a model. The rules are at the top of intel/run_harder_test.py and were fixed before any result was seen.", "",
             "Totals and worst runs are in units of the fixed stake per trade. Each is the average of several training runs.", ""]
    for kind, r in results.items():
        lines += [f"## {'Fixed Time' if kind == 'fixed_time' else 'InZone'}: {r['version']}", "", "| Test | Trades | Won | Average | Total | Worst run | By period |", "|---|---:|---:|---:|---:|---:|---|"]
        for name, title in (("as_tested", "As in the contest"), ("late", f"Entering {LATE_MINUTES} minutes late"), ("unseen", "Coins it never saw")):
            s = r[name]
            lines.append(f"| {title} | {s['trades']:,.0f} | {s['won']:.2%} | {s['avg']:+.4f} | {s['total']:+.1f} | {s['max_dd']:.1f} | {[round(a, 1) for a in s['periods']]} |")
        lines += ["", f"Late entry: **{'passed' if r['pass_late'] else 'failed'}**. Coins it never saw: **{'passed' if r['pass_unseen'] else 'failed'}**."]
        if r["move"] is not None:
            lines.append(f"Average move in its favour: {r['move']:+.3f}%, against about {REAL_COST}% to trade on a real exchange.")
        lines.append("")
    (docs / "HARDER.md").write_text("\n".join(lines), encoding="utf-8")
    print("wrote", docs / "HARDER.md", flush=True)


if __name__ == "__main__":
    main()
