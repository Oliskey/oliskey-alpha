"""Context from days to months: the extra inputs of the InZone model that won the all-coins contest (run_wide_contest.py).

long_view() is the definition, used in training and tests. Holder gives the same numbers for the newest minute of the live engine, without rolling over
months of minutes every minute: selftest.py checks that the two agree."""
from __future__ import annotations

import numpy as np
import pandas as pd

LONG = ["ret_1d", "ret_3d", "ret_7d", "ret_30d", "dist_200d", "range_30d", "vol_7d", "vol_30d"]
DAY = 1440
RET_DAYS = (("ret_1d", 1), ("ret_3d", 3), ("ret_7d", 7), ("ret_30d", 30))
HISTORY_DAYS = 300      # the longest input needs 200 finished days, and 120 is the fewest it accepts


def _day_tables(t: pd.Series, c: pd.Series) -> tuple[pd.Series, pd.Series, pd.Series, pd.Series]:
    """Per UTC day: the day index of each minute, and the three inputs that use finished days only."""
    day = pd.to_datetime(t, unit="ms", utc=True).dt.floor("D")
    closes = c.groupby(day).last()
    average = closes.rolling(200, min_periods=120).mean().shift(1)     # finished days only
    move = np.log(c).diff()
    daily_var = (move ** 2).groupby(day).sum()
    base = daily_var.rolling(90, min_periods=30).mean().shift(1)
    vol_7 = np.log(daily_var.rolling(7).mean().shift(1) / base)
    vol_30 = np.log(daily_var.rolling(30, min_periods=15).mean().shift(1) / base)
    return day, average, vol_7, vol_30


def long_view(df: pd.DataFrame) -> pd.DataFrame:
    """From that minute and earlier only."""
    c = df["c"]
    log = np.log(c)
    out = pd.DataFrame(index=df.index)
    for name, days in RET_DAYS:
        out[name] = log - log.shift(days * DAY)
    day, average, vol_7, vol_30 = _day_tables(df["t"], c)
    out["dist_200d"] = (log - np.log(day.map(average))).to_numpy()
    hi, lo = df["h"].rolling(30 * DAY, min_periods=10 * DAY).max(), df["l"].rolling(30 * DAY, min_periods=10 * DAY).min()
    out["range_30d"] = (c - lo) / (hi - lo).replace(0, np.nan)
    out["vol_7d"] = vol_7.reindex(day).to_numpy()
    out["vol_30d"] = vol_30.reindex(day).to_numpy()
    return out.astype("float32")


class Holder:
    """One coin in the live engine: the last 30 days of minutes in memory, and the day tables worked out once from the longer history."""

    def __init__(self, history: pd.DataFrame):
        self._tables = _day_tables(history["t"], history["c"])[1:]
        keep = history.tail(30 * DAY + 1)
        self._minutes = keep[["t", "h", "l", "c"]].reset_index(drop=True)
        self.day = int(history["t"].iat[-1] // 86_400_000)

    def add(self, new: pd.DataFrame) -> None:
        """New finished minutes, in order. The window stays 30 days long."""
        both = pd.concat([self._minutes, new[["t", "h", "l", "c"]]], ignore_index=True).drop_duplicates("t", keep="last").sort_values("t", ignore_index=True)
        self._minutes = both.tail(30 * DAY + 1).reset_index(drop=True)

    def is_current(self, t_ms: int) -> bool:
        """Whether this holder has the day tables for the day of minute t_ms: the tables only know the days they were built from, plus the next."""
        return int(t_ms // 86_400_000) <= self.day + 1 and int(self._minutes["t"].iat[-1]) >= t_ms - 60_000

    def reading(self, t_ms: int) -> dict[str, float] | None:
        """The inputs at minute t_ms, the newest minute held. None if the minutes do not reach it without a gap."""
        m = self._minutes
        if int(m["t"].iat[-1]) != t_ms or len(m) < 10 * DAY or int(m["t"].iat[-1] - m["t"].iat[0]) != (len(m) - 1) * 60_000:
            return None
        day = pd.Timestamp(t_ms // 86_400_000 * 86_400_000, unit="ms", tz="UTC")
        close = float(m["c"].iat[-1])
        log = np.log(close)
        out: dict[str, float] = {}
        for name, days in RET_DAYS:
            back = days * DAY
            out[name] = float(log - np.log(m["c"].iat[-1 - back])) if len(m) > back else np.nan
        average, vol_7, vol_30 = self._tables
        out["dist_200d"] = float(log - np.log(average.get(day, np.nan)))
        window = m.tail(30 * DAY)
        hi, lo = float(window["h"].max()), float(window["l"].min())
        out["range_30d"] = (close - lo) / (hi - lo) if hi > lo else np.nan
        out["vol_7d"] = float(vol_7.get(day, np.nan))
        out["vol_30d"] = float(vol_30.get(day, np.nan))
        return out
