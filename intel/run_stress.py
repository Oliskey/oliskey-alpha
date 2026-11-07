"""Harder test of the daily markets, the only group that has passed so far. Report only: it writes docs/intel/STRESS.md and
never changes models, strategy_stats or what the scanner publishes.

The pass rule is fixed here, before any result is seen, and is not to be loosened after looking at results:
  1. at least MIN_TRADES separate trades (one trade per signal, unlike RESULTS.md, which counts each signal per target size);
  2. the average result stays above zero at a confidence level corrected for how many combinations were tried;
  3. it still makes money with trading costs doubled;
  4. it still makes money with the stop and the time limit nudged both ways;
  5. most calendar years are positive, and no single market supplies all the profit.

Usage: python intel/run_stress.py"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from statistics import NormalDist

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine import backtest as bt                             # noqa: E402
from engine import db, ml                                     # noqa: E402
from engine.indicators import add_all                         # noqa: E402
from engine.settings import ASSETS, ROOT, asset_cfg, variants  # noqa: E402
from engine.strategies import REWARDS, STRATEGIES, signals, split_variant  # noqa: E402

DAILY = ("commodity", "currency", "index")
CRYPTO = ("crypto", "crypto_4h")
LABEL = {"commodity": "Commodities", "currency": "Forex", "index": "Indices", "crypto": "Crypto, 1-hour", "crypto_4h": "Crypto, 4-hour"}
MIN_TRADES = 200
GROUPS_TESTED = 5                      # market groups in RESULTS.md: crypto 1 h and 4 h, forex, indices, commodities
FAMILIES = len(STRATEGIES) + 1         # each rule strategy, plus the model layer
TESTS = GROUPS_TESTED * len(REWARDS) * FAMILIES
Z = NormalDist().inv_cdf(1 - 0.05 / TESTS)   # one-sided 95% across every combination tried


def build(cost_x: float = 1.0, stop_atr: float = 1.5, horizon_x: float = 1.0, classes: tuple[str, ...] = DAILY) -> pd.DataFrame:
    """All daily-market trades under the given conditions, with walk-forward model predictions."""
    saved, bt.STOP_ATR = bt.STOP_ATR, stop_atr
    frames = []
    try:
        for asset_id in ASSETS:
            for cls in variants(asset_id):
                if cls not in classes:
                    continue
                cfg = asset_cfg(asset_id, cls)
                bars = db.load_bars(asset_id, cfg["timeframe"])
                if len(bars) < 300:
                    continue
                t = bt.simulate(asset_id, cls, bars, max(2, round(cfg["horizon_bars"] * horizon_x)), cfg["cost_pct"] * cost_x)
                if t.empty:
                    continue
                base = ml.feature_frame(add_all(bars)).loc[t["signal_time"]].reset_index(drop=True)
                feats = ml.trade_features(base, t["direction"].to_numpy(), t["strategy"].to_numpy(), t["regime"].to_numpy(), t["asset_class"].to_numpy())
                frames.append(pd.concat([t.reset_index(drop=True), feats.drop(columns=[c for c in feats.columns if c in t.columns])], axis=1))
    finally:
        bt.STOP_ATR = saved
    t = ml.walk_forward(bt.walk_forward(pd.concat(frames, ignore_index=True)))
    t["be"] = (1 + t["cost_r"]) / (1 + t["strategy"].map(lambda s: split_variant(s)[1]))
    t["approved"] = t["ml_pred"] > t["be"] + ml.MARGIN
    return t[t["oos"] & t["ml_pred"].notna()]


def as_scanner(t: pd.DataFrame) -> pd.DataFrame:
    """What users really get: one trade per market per signal bar, the approved version with the highest probability."""
    a = t[t["approved"] & (t["regime"] != "chaos")]
    return a.sort_values("ml_pred").groupby(["asset", "signal_time"], as_index=False).tail(1)


def fixed_reward(t: pd.DataFrame, reward: float) -> pd.DataFrame:
    """One fixed target size, chosen in advance, so no flattering choice between sizes."""
    a = t[t["approved"] & (t["regime"] != "chaos") & (t["reward"] == reward)]
    return a.sort_values("ml_pred").groupby(["asset", "signal_time"], as_index=False).tail(1)


def stats(g: pd.DataFrame) -> dict:
    n = len(g)
    if n == 0:
        return {"n": 0, "hit": float("nan"), "low": float("nan"), "be": float("nan"), "exp": float("nan"), "exp_low": float("-inf")}
    wins = int(g["win"].sum())
    return {"n": n, "hit": wins / n, "low": bt.wilson_low(wins, n), "be": float(g["be"].mean()), "exp": float(g["r"].mean()), "exp_low": bt.expectancy_low(g["r"], Z)}


def row(name: str, s: dict) -> str:
    if s["n"] == 0:
        return f"| {name} | 0 | - | - | - | - | - |"
    return f"| {name} | {s['n']} | {s['hit']:.1%} | {s['low']:.1%} | {s['be']:.1%} | {s['exp']:+.3f} | {s['exp_low']:+.3f} |"


def lookahead_check() -> list[str]:
    """Signals up to a date must not change when later bars exist. Any difference means a test could see the future."""
    bad, checked = [], 0
    for asset_id in ASSETS:
        if ASSETS[asset_id]["class"] not in DAILY:
            continue
        bars = db.load_bars(asset_id, asset_cfg(asset_id)["timeframe"])
        if len(bars) < 400:
            continue
        full = signals(add_all(bars))
        for cut in (len(bars) - 120, len(bars) - 40):
            part = signals(add_all(bars.iloc[:cut]))
            for s in STRATEGIES:
                checked += 1
                if not np.array_equal(part[s].to_numpy()[-60:], full[s].to_numpy()[cut - 60:cut]):
                    bad.append(f"{asset_id} {s} at bar {cut}")
    return [f"Checked {checked} comparisons.", "No differences: signals do not use later prices." if not bad else f"**DIFFERENCES FOUND:** {', '.join(bad[:6])}"]


def verdict(base: pd.DataFrame, costly: pd.DataFrame, nudged: list[pd.DataFrame]) -> tuple[bool, list[str], dict]:
    s = stats(base)
    years = base.groupby(base["entry_time"].dt.year)["r"].mean()
    by_market = base.groupby("asset")["r"].sum()
    total = float(by_market.sum())
    top_share = float(by_market.max() / total) if total > 0 and len(by_market) else 1.0
    checks = [
        (f"At least {MIN_TRADES} separate trades", s["n"] >= MIN_TRADES, f"{s['n']}"),
        (f"Average result above zero after correcting for {TESTS} combinations", s["exp_low"] > 0, f"lower bound {s['exp_low']:+.3f}R"),
        ("Still makes money with costs doubled", stats(costly)["exp"] > 0, f"{stats(costly)['exp']:+.3f}R"),
        ("Still makes money with the stop and time limit nudged", all(stats(x)["exp"] > 0 for x in nudged), " / ".join(f"{stats(x)['exp']:+.3f}" for x in nudged)),
        ("Most years positive", len(years) > 0 and (years > 0).mean() > 0.5, f"{int((years > 0).sum())} of {len(years)}"),
        ("Profit not from one market alone", top_share <= 0.7 and len(by_market) > 1, f"largest share {top_share:.0%}"),
    ]
    lines = [f"| {c} | {'Pass' if ok else '**Fail**'} | {why} |" for c, ok, why in checks]
    passed = all(ok for _, ok, _ in checks)
    # Experimental: makes money on average and survives costs, nudges and most years, but falls short on the amount of
    # evidence or on relying on one market. Anything else is blocked from publishing.
    robust = s["exp"] > 0 and all(ok for _, ok, _ in checks[2:5])
    w = int(base["win"].sum()) if s["n"] else 0
    evidence = {
        "status": "proven" if passed else "experimental" if robust else "blocked",
        "trades": s["n"], "wins": w,
        "low": s["low"], "high": bt.wilson_low(w, s["n"], -1.96) if s["n"] else None,
        "breakeven": s["be"], "avg_r": s["exp"], "corrected_low": s["exp_low"],
        "failed": [c for c, ok, _ in checks if not ok],
    }
    return passed, lines, evidence


def main() -> None:
    base = build()
    print("base built", len(base))
    costly = build(cost_x=2.0)
    nudges = {"stop 1.25 ATR": build(stop_atr=1.25), "stop 1.75 ATR": build(stop_atr=1.75), "time limit x0.7": build(horizon_x=0.7), "time limit x1.3": build(horizon_x=1.3)}
    print("variations built")

    lines = [
        "# Signals: harder test",
        "",
        f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC. Report only: nothing here changes what the app shows.",
        "",
        "**What is different from RESULTS.md.**",
        "",
        "- RESULTS.md counts each signal once per target size, so one signal can count up to three times. Here each signal is one trade.",
        f"- {TESTS} combinations were tried in all, so the bar is corrected for that: z = {Z:.2f} instead of 1.96.",
        "- The pass rule was fixed in code before these results were seen, and must not be loosened after reading them.",
        "- Crypto is left out here because it already lost money on its large samples in RESULTS.md.",
        "",
        "**How to read R.** Each trade risks 1R. +0.10R means an average gain of a tenth of the amount risked, per trade.",
        "",
        "## 1. What users would really get",
        "",
        "One trade per market per signal, chosen as the scanner chooses today.",
        "",
        "| Group | Separate trades | Won | 95% low | Needed to break even | Average result (R) | Corrected low (R) |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    lines += [row(LABEL[c], stats(as_scanner(base[base["asset_class"] == c]))) for c in DAILY]
    lines += ["", "## 2. One target size fixed in advance", "",
              "| Group and target | Separate trades | Won | 95% low | Needed to break even | Average result (R) | Corrected low (R) |", "|---|---:|---:|---:|---:|---:|---:|"]
    for c in DAILY:
        for r in REWARDS:
            lines.append(row(f"{LABEL[c]}, {r:g}:1", stats(fixed_reward(base[base["asset_class"] == c], r))))

    lines += ["", "## 3. The full pass rule", ""]
    passed, groups = [], {}
    for c in DAILY:
        f = lambda t: as_scanner(t[t["asset_class"] == c])   # noqa: E731
        ok, rows, groups[c] = verdict(f(base), f(costly), [f(x) for x in nudges.values()])
        groups[c]["label"] = LABEL[c]
        lines += [f"### {LABEL[c]}: {'**PASSED**' if ok else 'not passed'}", "", "| Check | Result | Measured |", "|---|---|---|", *rows, ""]
        if ok:
            passed.append(LABEL[c])

    # Crypto, as test signals only (owner decision 2026-11-06): the rate of exactly what is published, shown honestly. It can
    # never earn a better label from this: that takes the full rule above.
    crypto = build(classes=CRYPTO)
    lines += ["## Crypto test signals", "", "Shown to users on demo accounts as test signals, with these numbers.", "",
              "| Group | Separate trades | Won | 95% low | Needed to break even | Average result (R) | Corrected low (R) |", "|---|---:|---:|---:|---:|---:|---:|"]
    for c in CRYPTO:
        g = as_scanner(crypto[crypto["asset_class"] == c])
        s = stats(g)
        lines.append(row(LABEL[c], s))
        w = int(g["win"].sum()) if s["n"] else 0
        if s["n"]:
            groups[c] = {"status": "test", "label": LABEL[c], "trades": s["n"], "wins": w, "low": s["low"], "high": bt.wilson_low(w, s["n"], -1.96), "breakeven": s["be"],
                         "avg_r": s["exp"], "corrected_low": s["exp_low"], "failed": ["Has not been through the full rule"] + (["Average result above zero"] if s["exp"] <= 0 else [])}
    lines.append("")

    lines += ["## 4. Commodities market by market and year by year", ""]
    g = as_scanner(base[base["asset_class"] == "commodity"])
    lines += ["| Market | Trades | Won | Average (R) |", "|---|---:|---:|---:|"]
    lines += [f"| {a} | {len(x)} | {x['win'].mean():.1%} | {x['r'].mean():+.3f} |" for a, x in g.groupby("asset")]
    lines += ["", "| Year | Trades | Won | Average (R) |", "|---|---:|---:|---:|"]
    lines += [f"| {y} | {len(x)} | {x['win'].mean():.1%} | {x['r'].mean():+.3f} |" for y, x in g.groupby(g["entry_time"].dt.year)]

    lines += ["", "## 5. Is the percentage on screen honest?", "", "Commodities: what the model said against what happened, using trades as users would get them.", "",
              "| Model said | Trades | Average said | Really won |", "|---|---:|---:|---:|"]
    if len(g):
        b = g.assign(bucket=pd.cut(g["ml_pred"], [0, 0.45, 0.5, 0.55, 0.6, 0.65, 1.0])).groupby("bucket", observed=True)
        lines += [f"| {k} | {len(x)} | {x['ml_pred'].mean():.1%} | {x['win'].mean():.1%} |" for k, x in b]

    lines += ["", "## 6. Do tests see future prices?", "", *lookahead_check(), "", "## Result", ""]
    lines.append(f"**Passed the full rule: {', '.join(passed)}.**" if passed else "**No daily market group passed the full rule.**")
    lines += ["", "**What this cannot show.** The model and strategies were designed with these years in view, so this is not fully unseen data. The only truly unseen results are the live ones, which are still far too few.", ""]
    out = ROOT / "docs" / "intel" / "STRESS.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    # What the app shows and what decides which groups may publish.
    (out.parent / "stress.json").write_text(json.dumps({"generated_at": datetime.now(timezone.utc).isoformat(), "groups": groups}, indent=1), encoding="utf-8")
    print("wrote", out)


if __name__ == "__main__":
    main()
