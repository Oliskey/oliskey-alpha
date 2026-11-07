"""Walk-forward backtest. Every signal becomes one trade per reward version: entry at the next bar's open, stop
1.5 ATR away, target R x the stop (R = 1, 1.5, 2), time exit after the horizon. Same-bar stop+target counts as a loss. Costs are charged on every trade.
Probabilities for a year come only from trades that finished in earlier years (no look-ahead)."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from .indicators import add_all
from .strategies import REWARDS, STOP_ATR, STRATEGIES, TARGET_ATR, signals, split_variant, variant_name

PRIOR = 10           # Beta(10, 10) prior: a combo needs real evidence before it moves far from 50%
MIN_TRADES = 200     # minimum out-of-sample trades before a strategy can be accepted


def wilson_low(wins: int, n: int, z: float = 1.96) -> float:
    if n == 0:
        return 0.0
    p = wins / n
    return (p + z * z / (2 * n) - z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n)


def resolve(df: pd.DataFrame, entry_i: int, direction: int, risk: float, horizon: int, reward: float = TARGET_ATR / STOP_ATR):
    """Outcome of a trade entered at bar entry_i's open. Returns (exit_i, gross_R, exit_price, how) or None if the
    horizon has not finished yet."""
    o, h, l, c = df["open"].to_numpy(), df["high"].to_numpy(), df["low"].to_numpy(), df["close"].to_numpy()
    entry = o[entry_i]
    stop = entry - direction * risk
    target = entry + direction * risk * reward
    last = entry_i + horizon - 1
    if last >= len(df):
        return None
    for j in range(entry_i, last + 1):
        hit_stop = l[j] <= stop if direction > 0 else h[j] >= stop
        hit_target = h[j] >= target if direction > 0 else l[j] <= target
        if hit_stop:                       # includes the same-bar case: assume the worse outcome
            return j, -1.0, stop, "stop"
        if hit_target:
            return j, reward, target, "target"
    return last, direction * (c[last] - entry) / risk, c[last], "time"


def simulate(asset_id: str, asset_class: str, bars: pd.DataFrame, horizon: int, cost_pct: float) -> pd.DataFrame:
    """All trades for one asset. One open trade per strategy at a time (signals during a trade are skipped)."""
    df = add_all(bars)
    sig = signals(df)
    rows = []
    atr = df["atr"].to_numpy()
    for strat, reward in ((s, r) for s in STRATEGIES for r in REWARDS):
        s = sig[strat].to_numpy()
        busy_until = -1
        for i in np.flatnonzero(s):
            if i <= busy_until or i + 1 >= len(df) or not atr[i] > 0:
                continue
            direction = int(s[i])
            risk = STOP_ATR * atr[i]
            res = resolve(df, i + 1, direction, risk, horizon, reward)
            if res is None:
                continue
            exit_i, gross_r, exit_price, how = res
            entry = df["open"].iat[i + 1]
            cost_r = (cost_pct / 100) * entry / risk
            rows.append({
                "asset": asset_id, "asset_class": asset_class, "strategy": variant_name(strat, reward), "reward": reward,
                "regime": sig["regime"].iat[i],
                "direction": direction, "signal_time": df.index[i], "entry_time": df.index[i + 1],
                "exit_time": df.index[exit_i], "gross_r": gross_r, "cost_r": cost_r, "r": gross_r - cost_r, "how": how,
            })
            busy_until = exit_i
    return pd.DataFrame(rows)


def expectancy_low(r: pd.Series, z: float = 1.96) -> float:
    """95% lower bound of the average result per trade (in R): mean - z * standard error."""
    n = len(r)
    if n < 2:
        return -math.inf
    return float(r.mean() - z * r.std(ddof=1) / math.sqrt(n))


def walk_forward(trades: pd.DataFrame) -> pd.DataFrame:
    """Adds `pred` = probability of a win known before each trade (from earlier calendar years only) and marks the
    out-of-sample trades (every year after the first)."""
    t = trades.sort_values("entry_time").copy()
    t["win"] = (t["r"] > 0).astype(int)
    t["year"] = t["entry_time"].dt.year
    years = sorted(t["year"].unique())
    t["pred"] = np.nan
    t["oos"] = t["year"] > years[0]
    for y in years[1:]:
        cutoff = pd.Timestamp(year=y, month=1, day=1, tz="UTC")
        past = t[t["exit_time"] < cutoff]
        stats = past.groupby(["strategy", "asset_class"])["win"].agg(["sum", "count"])
        mask = t["year"] == y
        for key, idx in t[mask].groupby(["strategy", "asset_class"]).groups.items():
            wins, n = (stats.loc[key, "sum"], stats.loc[key, "count"]) if key in stats.index else (0, 0)
            t.loc[idx, "pred"] = (wins + PRIOR) / (n + 2 * PRIOR)
    return t


def summarize(t: pd.DataFrame) -> pd.DataFrame:
    """Out-of-sample results per strategy and asset class, with the acceptance decision."""
    oos = t[t["oos"]]
    out = []
    for (strat, cls), g in oos.groupby(["strategy", "asset_class"]):
        n, wins = len(g), int(g["win"].sum())
        cost_r = g["cost_r"].mean()
        breakeven = (1 + cost_r) / (1 + split_variant(strat)[1])
        gains, losses = g.loc[g["r"] > 0, "r"].sum(), -g.loc[g["r"] <= 0, "r"].sum()
        equity = g.sort_values("exit_time")["r"].cumsum()
        max_dd = float((equity.cummax() - equity).max()) if n else 0.0
        low = wilson_low(wins, n)
        exp_r = float(g["r"].mean())
        exp_low = expectancy_low(g["r"])
        out.append({
            "strategy": strat, "asset_class": cls, "trades": n, "wins": wins, "hit_rate": wins / n,
            "hit_low": low, "breakeven": breakeven, "expectancy_r": exp_r,
            "profit_factor": gains / losses if losses > 0 else float("inf"), "max_drawdown_r": max_dd,
            # Money test as well as hit-rate test: with targets above 1:1 many "wins" are small time exits, so the
            # hit rate alone can clear break-even while the average result is ~0. Require the 95% lower bound of
            # the average result to be above zero.
            "accepted": bool(n >= MIN_TRADES and low > breakeven and exp_low > 0),
        })
    return pd.DataFrame(out).sort_values(["asset_class", "strategy"])


def calibration(t: pd.DataFrame) -> pd.DataFrame:
    """Predicted probability bucket vs what actually happened (out-of-sample)."""
    oos = t[t["oos"] & t["pred"].notna()].copy()
    oos["bucket"] = pd.cut(oos["pred"], [0, 0.4, 0.45, 0.5, 0.55, 0.6, 1.0])
    g = oos.groupby("bucket", observed=True).agg(trades=("win", "size"), predicted=("pred", "mean"), actual=("win", "mean"))
    return g.reset_index()
