"""Technical indicators on OHLC bars (pandas only). Every value at bar t uses bars <= t: no look-ahead."""
from __future__ import annotations

import numpy as np
import pandas as pd


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    down = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = up / down.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(100)


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    prev = df["close"].shift()
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev).abs(), (df["low"] - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def adx(df: pd.DataFrame, n: int = 14) -> pd.Series:
    up = df["high"].diff()
    down = -df["low"].diff()
    plus_dm = np.where((up > down) & (up > 0), up, 0.0)
    minus_dm = np.where((down > up) & (down > 0), down, 0.0)
    a = atr(df, n)
    plus_di = 100 * pd.Series(plus_dm, index=df.index).ewm(alpha=1 / n, adjust=False, min_periods=n).mean() / a
    minus_di = 100 * pd.Series(minus_dm, index=df.index).ewm(alpha=1 / n, adjust=False, min_periods=n).mean() / a
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    return dx.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def add_all(df: pd.DataFrame) -> pd.DataFrame:
    """Indicator columns used by the regime filter and the strategies."""
    out = df.copy()
    c = out["close"]
    out["ema20"], out["ema50"], out["ema200"] = ema(c, 20), ema(c, 50), ema(c, 200)
    out["rsi"] = rsi(c)
    out["atr"] = atr(out)
    out["adx"] = adx(out)
    mid = c.rolling(20).mean()
    sd = c.rolling(20).std()
    out["bb_mid"], out["bb_up"], out["bb_low"] = mid, mid + 2 * sd, mid - 2 * sd
    out["bb_width"] = (out["bb_up"] - out["bb_low"]) / mid
    out["bb_width_pct"] = out["bb_width"].rolling(120, min_periods=60).rank(pct=True)
    out["dc_high"] = out["high"].rolling(20).max().shift()   # previous 20 bars, excluding this one
    out["dc_low"] = out["low"].rolling(20).min().shift()
    out["atr_pct"] = out["atr"] / c
    out["atr_pct_rank"] = out["atr_pct"].rolling(200, min_periods=100).rank(pct=True)
    out["vol_ratio"] = out["volume"] / out["volume"].rolling(20).mean().replace(0, np.nan)
    return out
