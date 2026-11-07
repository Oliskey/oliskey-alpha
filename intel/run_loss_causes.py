"""Why does InZone win or lose, and could any of it be seen before entry? Writes docs/intel/CAUSES.md and causes.json. Runs weekly. The live scan reads the "active" list in causes.json.

It trains the live version the way it was judged, takes its trades on 3 separate periods it never trained on and on the newest 60 days, names the cause of every loss, and tests each
warning sign in engine.rootcause.SIGNS. Limits are set from data older than every period tested. It also names the causes of the live signals that lost.

RULE, FIXED 2026-11-07 BEFORE ANY RESULT WAS SEEN, the same as the when-to-trade rule (run_time_test.py) and not to be loosened. A sign becomes part of the strategy only if ALL hold:
  1. it loses money (average below zero) in each of the earlier periods;
  2. luck allowed for: its average, with days as the unit of evidence, is below zero by more than the Bonferroni bar for all the signs tried;
  3. confirmed on the latest period, which played no part in choosing: it loses there too;
  4. at least 500 trades with the sign;
  5. leaving those trades out raises total profit in every period;
  6. it also loses on the newest 60 days.
Being common among losses is not enough: a sign that shows on losses and wins alike would only remove profit.
WINS: it also names why each win won, and reports the opposite fifth of every sign as the conditions that win most. Report only: trading only in such conditions drops the other trades, and
earlier tests (run_quality_test.py) found that raises the win rate but lowers total profit, so it needs its own test passing that rule first, and the owner's goal is profit. Usage: python intel/run_loss_causes.py"""
from __future__ import annotations

import gc
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from statistics import NormalDist

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_market_contest as rm                                 # noqa: E402
import run_time_test as rtt                                      # noqa: E402
import run_wide_contest as rw                                    # noqa: E402
from engine import db                                            # noqa: E402
from engine.rootcause import CAUSES, classify, classify_win, MINUTES, RESULT, SIGNS, WINS   # noqa: E402
from engine.settings import ROOT                                 # noqa: E402
from engine.updown import ALL_COINS, IZ_VERSION                  # noqa: E402

rt, lab = rw.rt, rw.lab
SEED = 7
SHARE = 0.2          # a sign is the top or bottom fifth of its input


def values(frame: pd.DataFrame, column: str) -> pd.Series:
    return frame[column[4:]].abs() if column.startswith("abs:") else frame[column]


def closes_by_coin() -> dict[str, tuple[np.ndarray, np.ndarray]]:
    out = {}
    for sym in ALL_COINS:
        with np.load(rw.FOLDER / f"{sym}.npz") as z:
            out[sym] = (z["t"].astype("int64"), z["c"].astype("float64"))
    return out


def market_moves(prices: dict) -> pd.Series:
    """The average coin's move over the next hour, per starting minute."""
    moves = {s: pd.Series(np.log(np.roll(c, -MINUTES) / c)[:-MINUTES], index=t[:-MINUTES], dtype="float32") for s, (t, c) in prices.items()}
    return pd.DataFrame(moves).mean(axis=1)


def causes_of(losses: pd.DataFrame, prices: dict, market: pd.Series) -> pd.Series:
    """losses: t in ms as t_ms, coin, zone. The cause of each, or nothing if the prices are not all there."""
    found = pd.Series(index=losses.index, dtype="object")
    for sym, part in losses.groupby("coin"):
        t, c = prices[sym]
        at = np.searchsorted(t, part["t_ms"].to_numpy())
        for i, start, ms, zone in zip(part.index, at, part["t_ms"], part["zone"]):
            if start + MINUTES < len(t) and t[start] == ms:
                found[i] = classify(c[start:start + MINUTES + 1], float(zone), float(market.get(ms, 0.0)))
    return found


def win_causes_of(wins: pd.DataFrame, prices: dict) -> pd.Series:
    found = pd.Series(index=wins.index, dtype="object")
    for sym, part in wins.groupby("coin"):
        t, c = prices[sym]
        at = np.searchsorted(t, part["t_ms"].to_numpy())
        for i, start, ms, zone in zip(part.index, at, part["t_ms"], part["zone"]):
            if start + MINUTES < len(t) and t[start] == ms:
                found[i] = classify_win(c[start:start + MINUTES + 1], float(zone))
    return found


def live_losses(prices: dict, market: pd.Series) -> dict:
    """Every live InZone signal that lost, named the same way."""
    names = {v: k for k, v in ALL_COINS.items()}
    with db.connect() as c:
        rows = c.execute("""select asset_id, bar_time, entry, target from intel.ideas where asset_class in ('crypto_iz', 'crypto_iz_wide') and status = 'lost' and kind = 'idea'""").fetchall()
        won = c.execute("""select count(*) from intel.ideas where asset_class in ('crypto_iz', 'crypto_iz_wide') and status = 'won' and kind = 'idea'""").fetchone()[0]
    frame = pd.DataFrame([{"coin": names[a], "t_ms": int(b.timestamp() * 1000) - 60_000, "zone": float(h) / float(e) - 1} for a, b, e, h in rows if a in names])
    if frame.empty:
        return {"lost": 0, "won": int(won), "causes": {}}
    named = causes_of(frame, prices, market)
    return {"lost": len(frame), "won": int(won), "causes": {str(k): int(v) for k, v in named.value_counts().items()}, "unmeasured": int(named.isna().sum())}


def main() -> None:
    d = rm.build()
    cols = [c for c in d.columns if c not in rm.LABELS]
    v = rm.versions(cols, "inzone")[IZ_VERSION]
    keep = sorted({"zone_width", *((c[4:] if c.startswith("abs:") else c) for _, _, c, _ in SIGNS)})
    exam_from = d["t"].max() - pd.Timedelta(days=rw.EXAM_DAYS)
    gap = pd.Timedelta(minutes=120)
    last = exam_from - gap
    oldest = last - pd.Timedelta(days=rw.PERIOD_DAYS * rw.PERIODS)
    earlier = d[d["t"] < oldest]
    limits = {name: float(values(earlier, col).quantile(1 - SHARE if side == "high" else SHARE)) for name, _, col, side in SIGNS}
    del earlier
    found = []
    for k in list(range(rw.PERIODS)) + ["exam"]:
        if k == "exam":
            lo, hi = exam_from, d["t"].max() + gap
            train = d[(d["t"] < exam_from - gap) & (d["t"] >= exam_from - pd.Timedelta(days=4 * 365))]
        else:
            hi = last - pd.Timedelta(days=rw.PERIOD_DAYS * k)
            lo = hi - pd.Timedelta(days=rw.PERIOD_DAYS)
            train = d[(d["t"] < lo - gap) & (d["t"] >= lo - pd.Timedelta(days=4 * 365))]
        test = d[(d["t"] >= lo) & (d["t"] < hi)]
        take = rm.trades_on(train, test, v, "inzone", SEED)
        found.append(take.join(test[keep]).assign(period=k))
        print("period", k, len(take), "trades", flush=True)
        del train, test
        gc.collect()
    all_trades = pd.concat(found)
    del d
    gc.collect()
    exam = all_trades[all_trades["period"] == "exam"]
    t = all_trades[all_trades["period"] != "exam"].copy()
    t["period"] = t["period"].astype(int)
    periods = sorted(t["period"].unique(), key=lambda p: t.loc[t["period"] == p, "t"].min())
    bar_z = NormalDist().inv_cdf(0.05 / len(SIGNS))
    signs, active, best = [], [], []
    for name, words, col, side in SIGNS:
        limit = limits[name]
        hit = (lambda f: values(f, col) >= limit) if side == "high" else (lambda f: values(f, col) <= limit)
        s, e = t[hit(t)], exam[hit(exam)]
        loses_now = len(e) > 0 and float(e["r"].mean()) < 0
        ok = rtt.passes(s, periods, bar_z) and loses_now
        calm_limit = float(values(t, col).quantile(SHARE if side == "high" else 1 - SHARE))
        other = t[values(t, col) <= calm_limit] if side == "high" else t[values(t, col) >= calm_limit]
        best.append({"name": name, "words": words, "trades": len(other), "won": float(other["win"].mean()) if len(other) else 0.0, "avg": float(other["r"].mean()) if len(other) else 0.0, "total": float(other["r"].sum())})
        signs.append({"name": name, "words": words, "column": col, "side": side, "limit": limit, "trades": len(s), "won": float(s["win"].mean()) if len(s) else 0.0, "avg": float(s["r"].mean()) if len(s) else 0.0, "total": float(s["r"].sum()), "z": rtt.day_z(s),
                      "exam_trades": len(e), "exam_avg": float(e["r"].mean()) if len(e) else 0.0, "passed": bool(ok)})
        print(f"  {name:24} trades {len(s):6} won {signs[-1]['won']:.2%} avg {signs[-1]['avg']:+.4f} total {signs[-1]['total']:+8.1f} z {signs[-1]['z']:+.2f} exam avg {signs[-1]['exam_avg']:+.4f} {'PASSED' if ok else ''}", flush=True)
        if ok:
            active.append({"name": name, "words": words, "column": col, "side": side, "limit": limit})
    prices = closes_by_coin()
    market = market_moves(prices)
    lost = all_trades[~all_trades["win"].astype(bool)]
    named = causes_of(pd.DataFrame({"coin": lost["coin"], "t_ms": (lost["t"] - pd.Timestamp(0, tz="UTC")) // pd.Timedelta(milliseconds=1), "zone": lost["zone_width"].astype("float64")}), prices, market)
    tested = {str(k): int(n) for k, n in named.value_counts().items()}
    won = all_trades[all_trades["win"].astype(bool)]
    named_wins = win_causes_of(pd.DataFrame({"coin": won["coin"], "t_ms": (won["t"] - pd.Timestamp(0, tz="UTC")) // pd.Timedelta(milliseconds=1), "zone": won["zone_width"].astype("float64")}), prices)
    tested_wins = {str(k): int(n) for k, n in named_wins.value_counts().items()}
    live = live_losses(prices, market)
    out = {"generated_at": datetime.now(timezone.utc).isoformat(), "version": IZ_VERSION, "bar_z": bar_z, "trades": len(all_trades), "won": float(all_trades["win"].mean()), "tested_causes": tested, "tested_wins": tested_wins, "live": live, "signs": signs, "active": active, "best": best}
    RESULT.write_text(json.dumps(out, indent=1), encoding="utf-8")
    total = max(sum(tested.values()), 1)
    live_total = max(sum(live["causes"].values()), 1)
    lines = ["# Why InZone trades fail", "", f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC from {len(all_trades):,} test trades of the version trading now, and every live signal. The rule is at the top of intel/run_loss_causes.py and was fixed before any result was seen.", "",
             "## The cause of each loss", "", "| Cause | Test losses | Share | Live losses | Share |", "|---|---:|---:|---:|---:|"]
    lines += [f"| {CAUSES[k]} | {tested.get(k, 0):,} | {tested.get(k, 0) / total:.1%} | {live['causes'].get(k, 0):,} | {live['causes'].get(k, 0) / live_total:.1%} |" for k in CAUSES if k != "zone_late_price" and k not in WINS]
    lines += ["", f"Live signals so far: {live['won']} won, {live['lost']} lost. That is too few to compare closely with the tests.", "", "## Warning signs that could be seen before entry", "",
              "A sign becomes part of the strategy only if those trades lose money under the fixed rule. InZone breaks even at 47.62% won.", "", "| Before entry | Trades | Won | Per trade | Total | Newest 60 days, per trade | Added to strategy |", "|---|---:|---:|---:|---:|---:|---|"]
    lines += [f"| {s['words']} | {s['trades']:,} | {s['won']:.2%} | {s['avg']:+.4f} | {s['total']:+.1f} | {s['exam_avg']:+.4f} | {'**Yes**' if s['passed'] else 'No'} |" for s in sorted(signs, key=lambda x: x["avg"])]
    win_total = max(sum(tested_wins.values()), 1)
    lines += ["", "## Why trades win", "", "| Cause | Test wins | Share |", "|---|---:|---:|"]
    lines += [f"| {CAUSES[k]} | {tested_wins.get(k, 0):,} | {tested_wins.get(k, 0) / win_total:.1%} |" for k in WINS]
    lines += ["", "## Conditions that won most", "", f"The opposite of each warning sign, on the earlier periods. For comparison, all trades: {t['win'].mean():.2%} won, {t['r'].mean():+.4f} per trade, {t['r'].sum():+.1f} total. Report only: see the top of intel/run_loss_causes.py.", "", "| Opposite of | Trades | Won | Per trade | Total |", "|---|---:|---:|---:|---:|"]
    lines += [f"| {x['words']} | {x['trades']:,} | {x['won']:.2%} | {x['avg']:+.4f} | {x['total']:+.1f} |" for x in sorted(best, key=lambda x: -x["avg"])]
    lines.append("")
    (ROOT / "docs" / "intel" / "CAUSES.md").write_text("\n".join(lines), encoding="utf-8")
    print("tested causes", tested, flush=True)
    print("live", live, flush=True)
    print("active", [a["name"] for a in active] or "none", flush=True)


if __name__ == "__main__":
    main()
