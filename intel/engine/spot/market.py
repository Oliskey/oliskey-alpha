"""Market Intelligence for spot: features and regime, decided only from closed bars.

Rules from the spec (Part C/5):
  * ADX measures trend STRENGTH only; direction comes from EMA stacking, EMA slope and price position.
  * Volatility is judged by percentile of ATR/price over a trailing window, never by a raw ATR number.
  * When the evidence is thin or contradictory the answer is UNKNOWN / TRANSITIONAL, not a guess.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from engine.indicators import adx, atr, ema, rsi

REGIMES = ("TRENDING_UP", "TRENDING_DOWN", "RANGING", "BREAKOUT", "HIGH_VOLATILITY", "TRANSITIONAL", "UNKNOWN")
WARMUP = 210          # bars before EMA200 and the volatility rank mean anything
VOL_WINDOW = 500      # trailing bars for the volatility percentile


def trailing_rank(s: pd.Series, window: int) -> pd.Series:
    """Percentile (0..1) of each value within its own trailing window. Uses only past and current bars."""
    return s.rolling(window, min_periods=window // 2).rank(pct=True)


def features(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    c = out["close"]
    out["ema20"], out["ema50"], out["ema200"] = ema(c, 20), ema(c, 50), ema(c, 200)
    out["rsi"] = rsi(c)
    out["atr"] = atr(out)
    out["adx"] = adx(out)
    out["ema20_slope"] = out["ema20"].pct_change(3)
    out["ema50_slope"] = out["ema50"].pct_change(5)
    out["atr_pct"] = out["atr"] / c
    out["vol_rank"] = trailing_rank(out["atr_pct"], VOL_WINDOW)
    out["vol_med"] = out["volume"].rolling(20, min_periods=20).median()
    out["vol_ratio"] = out["volume"] / out["vol_med"]
    out["swing_low10"] = out["low"].rolling(10, min_periods=10).min()
    out["range_high20"] = out["high"].rolling(20, min_periods=20).max().shift(1)   # previous 20 bars only
    bb_mid = c.rolling(20, min_periods=20).mean()
    bb_sd = c.rolling(20, min_periods=20).std()
    out["bb_width"] = 4 * bb_sd / bb_mid
    out["bb_width_rank"] = trailing_rank(out["bb_width"], VOL_WINDOW)
    out["bar_no"] = np.arange(len(out))
    return out


def regime(f: pd.DataFrame) -> pd.DataFrame:
    """Regime label, trend direction, strength, uncertainty (0 = clear, 1 = no idea)."""
    up_cues = pd.concat([f["ema50"] > f["ema200"], f["close"] > f["ema50"], f["ema50_slope"] > 0,
                         f["ema20"] > f["ema50"]], axis=1).sum(axis=1)
    down_cues = pd.concat([f["ema50"] < f["ema200"], f["close"] < f["ema50"], f["ema50_slope"] < 0,
                           f["ema20"] < f["ema50"]], axis=1).sum(axis=1)
    strong = f["adx"] >= 20
    squeeze = f["bb_width_rank"].rolling(5, min_periods=5).min() < 0.25
    broke = (f["close"] > f["range_high20"]) & squeeze & (f["vol_ratio"] > 1.5)

    label = np.select(
        [f["bar_no"] < WARMUP, f["vol_rank"] > 0.92, broke, strong & (up_cues == 4), strong & (down_cues == 4),
         f["adx"] < 18],
        ["UNKNOWN", "HIGH_VOLATILITY", "BREAKOUT", "TRENDING_UP", "TRENDING_DOWN", "RANGING"],
        default="TRANSITIONAL")
    direction = np.select([up_cues >= 3, down_cues >= 3], ["UP", "DOWN"], default="FLAT")
    # Uncertainty: cues that disagree with the majority, plus a penalty when trend strength is middling.
    agree = np.maximum(up_cues, down_cues)
    uncertainty = (4 - agree) / 4 * 0.7 + np.where(f["adx"].between(18, 25), 0.3, 0.0)
    out = pd.DataFrame({"regime": label, "trend_direction": direction, "trend_strength": f["adx"].clip(0, 100),
                        "volatility_percentile": (f["vol_rank"] * 100).round(1),
                        "uncertainty": np.clip(uncertainty, 0, 1).round(2)}, index=f.index)
    out.loc[f["bar_no"] < WARMUP, ["trend_direction"]] = "UNKNOWN"
    out.loc[f["bar_no"] < WARMUP, ["uncertainty"]] = 1.0
    return out


RECOMMEND = {
    "TRENDING_UP": (["trend_following", "pullback"], ["mean_reversion_short", "breakdown"]),
    "TRENDING_DOWN": ([], ["trend_following_long", "pullback_long"]),
    "RANGING": (["mean_reversion"], ["trend_following", "breakout"]),
    "BREAKOUT": (["breakout"], ["mean_reversion"]),
    "HIGH_VOLATILITY": ([], ["scalping", "breakout"]),
    "TRANSITIONAL": ([], ["scalping"]),
    "UNKNOWN": ([], ["all"]),
}


def market_state(symbol: str, timeframe: str, f: pd.DataFrame) -> dict:
    """The MarketState contract (docs/spot/SPEC.md Part T) for the last closed bar."""
    r = regime(f).iloc[-1]
    last = f.iloc[-1]
    rec, avoid = RECOMMEND[r["regime"]]
    evidence = [f"close {last['close']:.2f} vs EMA50 {last['ema50']:.2f} vs EMA200 {last['ema200']:.2f}",
                f"ADX {last['adx']:.1f} (strength only)", f"volatility percentile {r['volatility_percentile']:.0f}"]
    return {"schemaVersion": "1.0", "symbol": symbol, "timeframe": timeframe, "asOf": str(f.index[-1]),
            "regime": r["regime"], "trendDirection": r["trend_direction"],
            "trendStrength": round(float(r["trend_strength"]), 1),
            "volatilityPercentile": float(r["volatility_percentile"]), "uncertainty": float(r["uncertainty"]),
            "recommended": rec, "avoid": avoid, "evidence": evidence,
            "levels": [{"kind": "SUPPORT", "price": round(float(last["swing_low10"]), 2)},
                       {"kind": "RESISTANCE", "price": round(float(last["range_high20"]), 2)}],
            "dataQuality": "OK"}
