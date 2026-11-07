"""Market regime and three transparent rule strategies. Signals are decided at a bar's close and traded at
the next bar's open. Parameters are fixed in advance (never tuned on the data)."""
from __future__ import annotations

import numpy as np
import pandas as pd

REGIMES = ("trend_up", "trend_down", "range", "chaos")
STRATEGIES = ("trend_pullback", "breakout", "mean_reversion")

STOP_ATR = 1.5      # stop distance in ATRs
TARGET_ATR = 1.5    # target distance in ATRs (1:1 reward to risk)

# Reward-to-risk versions tested for every strategy (owner request 2026-10-30): the target is R x the stop.
# A bigger target wins less often but needs fewer wins: break-even = (1 + cost) / (1 + R).
REWARDS = (1.0, 1.5, 2.0)


def variant_name(strategy: str, reward: float) -> str:
    """'breakout' for 1:1, 'breakout_1.5r' / 'breakout_2r' for bigger targets."""
    return strategy if reward == 1.0 else f"{strategy}_{reward:g}r"


def split_variant(name: str) -> tuple[str, float]:
    """('breakout', 2.0) from 'breakout_2r'; ('breakout', 1.0) from 'breakout'."""
    base, _, tail = name.rpartition("_")
    if base and tail.endswith("r"):
        try:
            return base, float(tail[:-1])
        except ValueError:
            pass
    return name, 1.0


def regime(df: pd.DataFrame) -> pd.Series:
    """trend_up / trend_down: ADX > 22 with EMAs stacked; chaos: volatility in its top 10%; otherwise range."""
    up = (df["adx"] > 22) & (df["ema50"] > df["ema200"]) & (df["close"] > df["ema50"])
    down = (df["adx"] > 22) & (df["ema50"] < df["ema200"]) & (df["close"] < df["ema50"])
    chaos = df["atr_pct_rank"] > 0.9
    r = np.select([chaos, up, down], ["chaos", "trend_up", "trend_down"], default="range")
    return pd.Series(r, index=df.index)


def signals(df: pd.DataFrame) -> pd.DataFrame:
    """One column per strategy: +1 = Up idea, -1 = Down idea, 0 = nothing, decided at this bar's close."""
    reg = regime(df)
    c, rsi = df["close"], df["rsi"]
    out = pd.DataFrame(index=df.index)

    # Trend pullback: in a trend, price dips to the 20 EMA and closes back on the trend side with RSI reset.
    long_pb = (reg == "trend_up") & (df["low"] <= df["ema20"]) & (c > df["ema20"]) & rsi.between(40, 60)
    short_pb = (reg == "trend_down") & (df["high"] >= df["ema20"]) & (c < df["ema20"]) & rsi.between(40, 60)
    out["trend_pullback"] = np.where(long_pb, 1, np.where(short_pb, -1, 0))

    # Breakout: close beyond the previous 20-bar range after a volatility squeeze; volume confirms where it exists.
    squeezed = df["bb_width_pct"].rolling(5).min() < 0.3
    vol_ok = df["vol_ratio"].isna() | (df["volume"] == 0) | (df["vol_ratio"] > 1.5)
    long_bo = squeezed & vol_ok & (c > df["dc_high"]) & (reg != "chaos")
    short_bo = squeezed & vol_ok & (c < df["dc_low"]) & (reg != "chaos")
    out["breakout"] = np.where(long_bo, 1, np.where(short_bo, -1, 0))

    # Mean reversion: in a range, a close outside the Bollinger band with stretched RSI.
    long_mr = (reg == "range") & (c < df["bb_low"]) & (rsi < 30)
    short_mr = (reg == "range") & (c > df["bb_up"]) & (rsi > 70)
    out["mean_reversion"] = np.where(long_mr, 1, np.where(short_mr, -1, 0))

    out["regime"] = reg
    return out


def plain_reasons(strategy: str, direction: int, row: pd.Series, reg: str, tf_label: str, reward: float = 1.0) -> list[str]:
    """A few short, factual reasons for an idea, in plain words (shown in the app)."""
    trend = {"trend_up": "rising", "trend_down": "falling", "range": "moving sideways", "chaos": "very jumpy"}[reg]
    reasons = [f"{tf_label} chart: the market is {trend}"]
    if strategy == "trend_pullback":
        reasons.append(f"the price dipped against the trend, then closed back {'above' if direction > 0 else 'below'} its recent average")
    elif strategy == "breakout":
        reasons.append(f"after a quiet spell, the price closed {'above its recent high' if direction > 0 else 'below its recent low'}")
        if row.get("vol_ratio") and row["vol_ratio"] == row["vol_ratio"] and row["volume"] > 0:
            reasons.append(f"trading volume was {row['vol_ratio']:.1f} times its recent average")
    else:
        reasons.append(f"the price stretched far {'below' if direction > 0 else 'above'} its usual range, and may move back towards the middle")
    reasons.append(f"the target is {reward:g} times as far as the stop")
    return reasons
