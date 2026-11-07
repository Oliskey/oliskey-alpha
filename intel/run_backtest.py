"""Walk-forward backtest over all cached markets and test variants (rules + LightGBM layer).
Writes docs/intel/RESULTS.md, saves the live ML models, and stores what is accepted in intel.strategy_stats
(the scanner only publishes ideas from accepted rules or an accepted ML layer).
Usage: python intel/run_backtest.py"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine import db, ml                                     # noqa: E402
from engine.backtest import calibration, simulate, summarize, walk_forward  # noqa: E402
from engine.indicators import add_all                         # noqa: E402
from engine.settings import ASSETS, ROOT, asset_cfg, variants  # noqa: E402

LABEL = {"crypto": "Crypto (1 h bars)", "crypto_4h": "Crypto (4 h bars)", "currency": "Forex (daily)",
         "index": "Indices (daily)", "commodity": "Commodities (daily)"}
from engine.strategies import split_variant  # noqa: E402
NAMES = {"trend_pullback": "Trend pullback", "breakout": "Breakout", "mean_reversion": "Mean reversion"}


def strat_label(name: str) -> str:
    """'Breakout' for 1:1, 'Breakout (2:1)' for the bigger-target versions."""
    base, reward = split_variant(name)
    return NAMES[base] + ("" if reward == 1.0 else f" ({reward:g}:1)")


def main() -> None:
    db.ensure_schema()
    all_trades, span = [], {}
    for asset_id in ASSETS:
        for cls in variants(asset_id):
            cfg = asset_cfg(asset_id, cls)
            bars = db.load_bars(asset_id, cfg["timeframe"])
            if len(bars) < 300:
                print(f"skip {asset_id} {cls}: only {len(bars)} bars")
                continue
            span[f"{asset_id} ({cfg['timeframe']})"] = (bars.index.min(), bars.index.max(), len(bars))
            t = simulate(asset_id, cls, bars, cfg["horizon_bars"], cfg["cost_pct"])
            if t.empty:
                continue
            base = ml.feature_frame(add_all(bars)).loc[t["signal_time"]].reset_index(drop=True)
            feats = ml.trade_features(base, t["direction"].to_numpy(), t["strategy"].to_numpy(),
                                      t["regime"].to_numpy(), t["asset_class"].to_numpy())
            # columns both frames carry (e.g. reward) are identical: keep the trade's copy so each feature appears once
            all_trades.append(pd.concat([t.reset_index(drop=True), feats.drop(columns=[c for c in feats.columns if c in t.columns])], axis=1))
            print(f"{asset_id} {cls}: {len(bars)} bars, {len(t)} trades")

    trades = walk_forward(pd.concat(all_trades, ignore_index=True))
    rules = summarize(trades)
    trades = ml.walk_forward(trades)
    ml_summary = ml.summarize(trades)
    importances = ml.fit_final(trades[trades["exit_time"] <= trades["exit_time"].max()])
    calib = calibration(trades)
    save_stats(rules, ml_summary)
    write_report(trades, rules, ml_summary, importances, calib, span)
    print(rules.to_string(index=False))
    print(ml_summary.to_string(index=False))


def save_stats(rules: pd.DataFrame, ml_summary: pd.DataFrame) -> None:
    with db.connect() as c:
        c.execute("delete from intel.strategy_stats")
        for r in rules.itertuples():
            c.execute(
                """insert into intel.strategy_stats (strategy, asset_class, regime, trades, wins, hit_rate, hit_low,
                   breakeven, expectancy_r, accepted) values (%s, %s, 'all', %s, %s, %s, %s, %s, %s, %s)""",
                (r.strategy, r.asset_class, r.trades, r.wins, r.hit_rate, r.hit_low, r.breakeven, r.expectancy_r, r.accepted))
        for r in ml_summary.itertuples():
            c.execute(
                """insert into intel.strategy_stats (strategy, asset_class, regime, trades, wins, hit_rate, hit_low,
                   breakeven, expectancy_r, accepted) values ('ml', %s, 'all', %s, %s, %s, %s, %s, %s, %s)""",
                (r.asset_class, r.taken, r.wins, r.hit_rate, r.hit_low, r.breakeven, r.expectancy_r, r.accepted))


def write_report(trades, rules, ml_summary, importances, calib, span) -> None:
    oos = trades[trades["oos"]]
    lines = [
        "# Market Intelligence Engine: walk-forward results",
        "",
        f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC from {len(span)} market/timeframe series, "
        f"{len(trades):,} simulated trades ({len(oos):,} out-of-sample).",
        "",
        "**How to read this.** Every trade risks 1R (stop 1.5 ATR) and aims for 1R, 1.5R or 2R (the \"(1.5:1)\" and "
        "\"(2:1)\" versions). *Break-even* is the hit rate needed to cover costs: (1 + cost) / (1 + R). A strategy is **accepted** "
        "only if, out-of-sample, it has at least 200 trades, the 95% lower bound of its hit rate is above break-even, "
        "and the 95% lower bound of its average result (expectancy, in R) is above zero - with targets above 1:1 many "
        "\"wins\" are small time exits, so the hit rate alone is not enough. Out-of-sample = every calendar year after the first; "
        "each year's probabilities and models come only from earlier years. Same-bar stop+target counts as a loss.",
        "",
        "## 1. Rule strategies (out-of-sample)",
        "",
        "| Market | Strategy | Trades | Hit rate | 95% low | Break-even | Expectancy (R) | Profit factor | Max drawdown (R) | Verdict |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for r in rules.itertuples():
        pf = "∞" if r.profit_factor == float("inf") else f"{r.profit_factor:.2f}"
        lines.append(
            f"| {LABEL[r.asset_class]} | {strat_label(r.strategy)} | {r.trades} | {r.hit_rate:.1%} | {r.hit_low:.1%} | "
            f"{r.breakeven:.1%} | {r.expectancy_r:+.3f} | {pf} | {r.max_drawdown_r:.1f} | "
            f"{'**Accepted**' if r.accepted else 'Rejected'} |")

    lines += ["", "### Crypto: 1-hour vs 4-hour bars (all three strategies together, out-of-sample)", "",
              "| Bars | Trades | Hit rate | Break-even | Expectancy (R) |", "|---|---:|---:|---:|---:|"]
    for cls in ("crypto", "crypto_4h"):
        g = oos[oos["asset_class"] == cls]
        if len(g):
            lines.append(f"| {LABEL[cls]} | {len(g):,} | {g['win'].mean():.1%} | {(1 + g['cost_r'].mean()) / 2:.1%} | "
                         f"{g['r'].mean():+.3f} |")

    lines += ["", "## 2. LightGBM layer (out-of-sample)", "",
              f"For every rule setup the model estimates P(win) from {len(ml.FEATURES)} features at the signal bar "
              "(trend distance and slope in ATRs, recent returns, RSI, ADX, volatility rank, squeeze, volume, time, "
              "strategy, regime). Model probability is isotonic-calibrated and blended 70/30 with the rule's history. "
              f"The layer **takes** a setup only when that probability beats break-even by {ml.MARGIN:.0%}. "
              "One model per group: crypto 1 h, crypto 4 h, daily markets pooled.",
              "",
              "| Market | Setups | Taken by ML | Hit rate (taken) | 95% low | Break-even | Expectancy taken (R) | Expectancy all setups (R) | Verdict |",
              "|---|---:|---:|---:|---:|---:|---:|---:|---|"]
    for r in ml_summary.itertuples():
        lines.append(
            f"| {LABEL[r.asset_class]} | {r.setups:,} | {r.taken:,} | {r.hit_rate:.1%} | {r.hit_low:.1%} | "
            f"{r.breakeven:.1%} | {r.expectancy_r:+.3f} | {r.all_setups_exp:+.3f} | "
            f"{'**Accepted**' if r.accepted else 'Rejected'} |")
    lines += ["", "**What the models lean on most** (share of total gain, live models trained on all finished trades):", ""]
    for g, imp in importances.items():
        lines.append(f"- {g}: " + ", ".join(f"{f} {s:.0%}" for f, s in imp))

    accepted = [f"{strat_label(r.strategy)} on {LABEL[r.asset_class]}" for r in rules.itertuples() if r.accepted] + \
               [f"LightGBM layer on {LABEL[r.asset_class]}" for r in ml_summary.itertuples() if r.accepted]
    lines += ["", "## Verdict", ""]
    if not accepted:
        lines.append("**Nothing passed.** Neither the rules nor the LightGBM layer showed an edge that survives costs "
                     "out-of-sample, so the scanner publishes no trade ideas. Setups are logged as \"don't enter\" "
                     "and resolved, and every live crypto setup is forward-tested with demo money.")
    else:
        lines.append("Accepted (the scanner publishes ideas only from these): " + "; ".join(accepted) + ".")

    lines += ["", "## Calibration of the rule probabilities (out-of-sample)", "",
              "| Predicted bucket | Trades | Predicted | Actual |", "|---|---:|---:|---:|"]
    for r in calib.itertuples():
        lines.append(f"| {r.bucket} | {r.trades} | {r.predicted:.1%} | {r.actual:.1%} |")
    ml_oos = oos[oos["ml_pred"].notna()].copy() if "ml_pred" in oos else pd.DataFrame()
    if len(ml_oos):
        ml_oos["bucket"] = pd.cut(ml_oos["ml_pred"], [0, 0.4, 0.45, 0.5, 0.55, 0.6, 1.0])
        lines += ["", "## Calibration of the LightGBM probabilities (out-of-sample)", "",
                  "| Predicted bucket | Trades | Predicted | Actual |", "|---|---:|---:|---:|"]
        for b, g in ml_oos.groupby("bucket", observed=True):
            lines.append(f"| {b} | {len(g)} | {g['ml_pred'].mean():.1%} | {g['win'].mean():.1%} |")

    lines += ["", "## Out-of-sample by year", "", "| Year | Trades | Hit rate | Expectancy (R) |", "|---|---:|---:|---:|"]
    for y, g in oos.groupby("year"):
        lines.append(f"| {y} | {len(g)} | {g['win'].mean():.1%} | {g['r'].mean():+.3f} |")
    lines += ["", "## Data used", "", "| Series | From | To | Bars |", "|---|---|---|---:|"]
    for a, (lo, hi, n) in sorted(span.items()):
        lines.append(f"| {a} | {lo:%Y-%m-%d} | {hi:%Y-%m-%d} | {n:,} |")
    lines += ["", "_Probability, not a promise. Educational, not financial advice._", ""]
    out = ROOT / "docs" / "intel" / "RESULTS.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
