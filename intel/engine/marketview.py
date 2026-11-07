"""Two more kinds of input, for the InZone model that won run_market_contest.py and passed run_wide_harder.py. All from that minute and earlier only: selftest.py checks it.

market_view: what all 17 coins are doing together. corridor_view: how the InZone corridor has been holding on this coin lately."""
from __future__ import annotations

import numpy as np
import pandas as pd

MARKET = ["mkt_ret_60", "mkt_up_60", "mkt_spread_60", "mkt_jumpy", "own_vs_mkt_60"]
CORRIDOR = ["zone_width", "zone_vs_day", "hit_24h", "hit_7d"]
DAY = 1440
IZ_MINUTES = 60
CORRIDOR_ROWS = 7 * DAY + 400     # enough for the 7-day window, the hour before it and the longest volatility window
MARKET_ROWS = 300                 # enough for the longest window in market_view


def market_view(closes: pd.DataFrame) -> dict[str, pd.Series]:
    """Closes with one column per coin and one row per minute. Gives one series per input, except own_vs_mkt_60, which corridor callers work out per coin."""
    log = np.log(closes)
    moved = log.diff(IZ_MINUTES)
    step = log.diff()
    jumpy = (step.rolling(15).var() / step.rolling(240).var()).mean(axis=1)
    return {"mkt_ret_60": moved.mean(axis=1), "mkt_up_60": (moved > 0).sum(axis=1) / moved.notna().sum(axis=1).replace(0, np.nan),
            "mkt_spread_60": moved.std(axis=1), "mkt_jumpy": jumpy}


def corridor_view(c: pd.Series, h: pd.Series, l: pd.Series, sigma: pd.Series, q: float) -> pd.DataFrame:
    """A corridor set an hour ago is finished now, so its result is known at this minute and no sooner."""
    width = q * sigma * np.sqrt(IZ_MINUTES)
    inside = (np.log(c / c.shift(IZ_MINUTES)).abs() <= width.shift(IZ_MINUTES)).astype("float32").where(width.shift(IZ_MINUTES).notna())
    day_range = (h.rolling(DAY, min_periods=DAY // 2).max() - l.rolling(DAY, min_periods=DAY // 2).min()) / c
    return pd.DataFrame({"zone_width": width, "zone_vs_day": width / day_range.replace(0, np.nan),
                         "hit_24h": inside.rolling(DAY, min_periods=DAY // 2).mean(), "hit_7d": inside.rolling(7 * DAY, min_periods=DAY).mean()}).astype("float32")
