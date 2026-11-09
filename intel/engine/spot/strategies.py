"""The four starter strategies (docs/spot/SPEC.md Part D) as fixed, declared rules. Long-only spot.

Parameters were written down BEFORE any test was run and are not tuned on the data. A strategy that fails its
tests is reported as failed; it is never re-tuned until it passes (that would be fitting noise).

Change from the spec, forced by data: scalping signals use 15m bars (the 5m history available here is too short).

Every signal is decided at a bar's CLOSE and can only be traded at the NEXT bar's open (see backtest.py).
Higher-timeframe context is joined on CLOSE times, so a 1d bar is visible only after it has closed.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from engine.spot.market import features, regime

TF_DELTA = {"15m": pd.Timedelta(minutes=15), "1h": pd.Timedelta(hours=1), "4h": pd.Timedelta(hours=4),
            "1d": pd.Timedelta(days=1)}


@dataclass(frozen=True)
class Spec:
    strategy_id: str
    version: str
    style: str                 # scalp | swing
    timeframe: str
    context_timeframe: str
    context_rule: str          # "up" = context trend must be up; "not_down" = context must not be down
    adx_min: float
    rsi_low: float
    rsi_high: float
    vol_confirm: float         # volume ratio needed (0 = none)
    stop_atr_min: float        # stop at least this many ATRs below entry
    target_r: float
    time_stop_bars: int
    time_stop_min_r: float     # exit at the time stop unless the trade is at least this many R in profit
    max_spread_pct: float
    cost_per_side: float       # fee + half spread + slippage, fraction of price, per side (stressed in tests)
    hypothesis: str

    def as_dict(self) -> dict:
        return asdict(self)


SPECS = (
    Spec("strict_scalp", "0.1.0", "scalp", "15m", "1h", "up", 25, 40, 55, 1.2, 0.8, 1.5, 8, 0.5, 0.0003, 0.0012,
         "In a strong 15m up-trend inside a 1h up-trend, a reset pullback to EMA20 that closes back above it on "
         "rising volume continues upward often enough to pay 1.5R after costs."),
    Spec("balanced_scalp", "0.1.0", "scalp", "15m", "1h", "not_down", 20, 38, 60, 0.0, 1.0, 1.2, 12, 0.0, 0.0005,
         0.0012, "A looser version: any EMA20 pullback in a 15m up-trend that is not against the 1h trend."),
    Spec("strict_swing", "0.1.0", "swing", "4h", "1d", "up", 25, 40, 60, 0.0, 1.5, 2.5, 30, 1.0, 0.001, 0.0012,
         "In a confirmed daily up-trend, 4h pullbacks to EMA50 that close bullish resolve upward to 2.5R more "
         "often than the 29% a 2.5R target needs to break even after costs."),
    Spec("balanced_swing", "0.1.0", "swing", "4h", "1d", "not_down", 20, 38, 65, 0.0, 2.0, 2.0, 42, 0.0, 0.001,
         0.0012, "Pullbacks to the EMA20-EMA50 band in a 4h up-trend that is not against the daily trend."),
)
BY_ID = {s.strategy_id: s for s in SPECS}


def with_context(sig: pd.DataFrame, ctx_raw: pd.DataFrame, sig_tf: str, ctx_tf: str) -> pd.DataFrame:
    """Attach the latest CLOSED higher-timeframe bar's trend state to each signal bar (no look-ahead)."""
    cf = features(ctx_raw)
    cr = regime(cf)
    ctx = pd.DataFrame({
        "ctx_up": (cf["close"] > cf["ema50"]) & (cf["ema50"] > cf["ema200"]) & (cf["ema50_slope"] > 0),
        "ctx_down": (cf["close"] < cf["ema50"]) & (cf["ema50"] < cf["ema200"]),
        "ctx_regime": cr["regime"]})
    ctx["avail"] = ctx.index + TF_DELTA[ctx_tf]                  # the context bar is known at its close
    left = pd.DataFrame({"decided": sig.index + TF_DELTA[sig_tf]}, index=sig.index)
    m = pd.merge_asof(left.reset_index(), ctx.reset_index(drop=True).sort_values("avail"),
                      left_on="decided", right_on="avail", direction="backward")
    m.index = sig.index
    out = sig.copy()
    out["ctx_up"] = m["ctx_up"].astype("boolean").fillna(False).astype(bool)
    out["ctx_down"] = m["ctx_down"].astype("boolean").fillna(True).astype(bool)   # unknown context = treat as down
    out["ctx_regime"] = m["ctx_regime"].fillna("UNKNOWN")
    return out


def prepare(sig_raw: pd.DataFrame, ctx_raw: pd.DataFrame, spec: Spec) -> pd.DataFrame:
    f = features(sig_raw)
    f = f.join(regime(f))
    return with_context(f, ctx_raw, spec.timeframe, spec.context_timeframe)


def entries(f: pd.DataFrame, spec: Spec) -> pd.Series:
    """True where the strategy wants to OPEN_LONG at the next bar's open. Never a short."""
    c = f["close"]
    ctx_ok = f["ctx_up"] if spec.context_rule == "up" else ~f["ctx_down"]
    trend = (f["ema20"] > f["ema50"]) & (f["adx"] >= spec.adx_min) & (f["ema50_slope"] > 0)
    if spec.strategy_id == "strict_scalp":
        trend &= f["ema20_slope"] > 0
    if spec.style == "swing" and spec.context_rule == "up":
        trend &= c > f["ema200"]
    if spec.strategy_id == "strict_swing":
        touched = f["low"] <= f["ema50"] * 1.003
    elif spec.strategy_id == "balanced_swing":
        touched = f["low"] <= f["ema20"]
    else:
        touched = f["low"] <= f["ema20"]
    # Reclaim level as written in the spec: scalps close back above EMA20; swings need a bullish close above EMA50.
    level = f["ema50"] if spec.style == "swing" else f["ema20"]
    reclaimed = (c > level) & (c > f["open"])
    rsi_ok = f["rsi"].between(spec.rsi_low, spec.rsi_high)
    vol_ok = f["vol_ratio"] >= spec.vol_confirm if spec.vol_confirm else pd.Series(True, index=f.index)
    calm = f["vol_rank"] <= 0.90                                # no entries in the top 10% volatility
    known = f["regime"] != "UNKNOWN"
    return (ctx_ok & trend & touched & reclaimed & rsi_ok & vol_ok & calm & known).fillna(False)


def stop_price(row: pd.Series, entry: float, spec: Spec) -> float:
    """Below the recent swing low, but never closer than stop_atr_min ATRs to the entry."""
    structural = row["swing_low10"] - 0.2 * row["atr"]
    return float(min(structural, entry - spec.stop_atr_min * row["atr"]))
