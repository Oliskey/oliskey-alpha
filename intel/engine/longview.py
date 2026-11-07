"""Context from days to months: the extra inputs of the InZone model that won the all-coins contest (run_wide_contest.py).

long_view() is the definition, used in training and tests. Holder gives the same numbers for the newest minute of the live engine, without rolling over
months of minutes every minute: selftest.py checks that the two agree."""
from __future__ import annotations

import numpy as np
import pandas as pd

LONG = ["ret_1d", "ret_3d", "ret_7d", "ret_30d", "dist_200d", "range_30d", "vol_7d", "vol_30d"]
DAY = 1440
DAY_MS = 86_400_000
RET_DAYS = (("ret_1d", 1), ("ret_3d", 3), ("ret_7d", 7), ("ret_30d", 30))
HISTORY_DAYS = 300      # the longest input averages 200 finished days
WINDOW = 30 * DAY


def long_view(df: pd.DataFrame) -> pd.DataFrame:
    """From that minute and earlier only."""
    c = df["c"]
    log = np.log(c)
    out = pd.DataFrame(index=df.index)
    for name, days in RET_DAYS:
        out[name] = log - log.shift(days * DAY)
    # daily closes for the longest windows: far lighter than rolling over 288,000 minutes, and it cannot see ahead
    day = pd.to_datetime(df["t"], unit="ms", utc=True).dt.floor("D")
    closes = c.groupby(day).last()
    average = closes.rolling(200, min_periods=120).mean().shift(1)     # finished days only
    out["dist_200d"] = (log - np.log(day.map(average))).to_numpy()
    hi, lo = df["h"].rolling(WINDOW, min_periods=10 * DAY).max(), df["l"].rolling(WINDOW, min_periods=10 * DAY).min()
    out["range_30d"] = (c - lo) / (hi - lo).replace(0, np.nan)
    move = log.diff()
    daily_var = (move ** 2).groupby(day).sum()
    base = daily_var.rolling(90, min_periods=30).mean().shift(1)
    out["vol_7d"] = (np.log(daily_var.rolling(7).mean().shift(1) / base)).reindex(day).to_numpy()
    out["vol_30d"] = (np.log(daily_var.rolling(30, min_periods=15).mean().shift(1) / base)).reindex(day).to_numpy()
    return out.astype("float32")


def _mean(values: list[float], want: int, least: int) -> float:
    """The mean of the newest `want` values, as a rolling window with that many minimum values would give it."""
    part = values[-want:]
    return float(np.mean(part)) if len(part) >= least else np.nan


class Holder:
    """One coin in the live engine: 30 days of minutes and one close and one variance per day. Each new minute costs almost nothing."""

    def __init__(self, history: pd.DataFrame):
        h = history.tail(HISTORY_DAYS * DAY + 1).reset_index(drop=True)
        day = h["t"].to_numpy() // DAY_MS
        c = pd.Series(h["c"].to_numpy(dtype="float64"))
        self._closes = c.groupby(day).last().to_dict()
        self._vars = (np.log(c).diff() ** 2).groupby(day).sum().to_dict()
        keep = h.tail(WINDOW + 1)
        self._t = keep["t"].to_numpy(dtype="int64")
        self._h, self._l, self._c = (keep[k].to_numpy(dtype="float64") for k in ("h", "l", "c"))
        self._table: tuple[int, tuple[float, float, float]] | None = None

    @property
    def last(self) -> int:
        return int(self._t[-1])

    def add(self, new: pd.DataFrame) -> None:
        """Finished minutes, in order, joining straight on from the newest held. Minutes already held are skipped."""
        fresh = new[new["t"] > self.last]
        if fresh.empty:
            return
        t, c = fresh["t"].to_numpy(dtype="int64"), fresh["c"].to_numpy(dtype="float64")
        before = np.concatenate(([self._c[-1]], c[:-1]))
        for when, close, var in zip(t // DAY_MS, c, np.log(c / before) ** 2):
            when = int(when)
            self._closes[when] = float(close)
            self._vars[when] = self._vars.get(when, 0.0) + float(var)
        self._t = np.concatenate((self._t, t))[-WINDOW - 1:]
        self._c = np.concatenate((self._c, c))[-WINDOW - 1:]
        self._h = np.concatenate((self._h, fresh["h"].to_numpy(dtype="float64")))[-WINDOW - 1:]
        self._l = np.concatenate((self._l, fresh["l"].to_numpy(dtype="float64")))[-WINDOW - 1:]
        oldest = int(t[-1] // DAY_MS) - HISTORY_DAYS
        for table in (self._closes, self._vars):
            for d in [d for d in table if d < oldest]:
                del table[d]

    def _day_inputs(self, today: int) -> tuple[float, float, float]:
        """The inputs that use finished days only, so they change once a day."""
        if self._table and self._table[0] == today:
            return self._table[1]
        closes = [self._closes[d] for d in sorted(self._closes) if d < today]
        var = [self._vars[d] for d in sorted(self._vars) if d < today]
        base = _mean(var, 90, 30)
        values = (_mean(closes, 200, 120), np.log(_mean(var, 7, 7) / base), np.log(_mean(var, 30, 15) / base))
        self._table = (today, values)
        return values

    def reading(self) -> dict[str, float]:
        """The inputs at the newest minute held."""
        close = float(self._c[-1])
        log = np.log(close)
        out = {name: float(log - np.log(self._c[-1 - days * DAY])) if len(self._c) > days * DAY else np.nan for name, days in RET_DAYS}
        average, vol_7, vol_30 = self._day_inputs(self.last // DAY_MS)
        out["dist_200d"] = float(log - np.log(average))
        hi, lo = float(self._h[-WINDOW:].max()), float(self._l[-WINDOW:].min())
        out["range_30d"] = (close - lo) / (hi - lo) if hi > lo else np.nan
        out["vol_7d"], out["vol_30d"] = float(vol_7), float(vol_30)
        return out
