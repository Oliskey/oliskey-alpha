"""Downloads 4 years of real 1-minute candles from Binance for all 17 live coins, into the cache outside OneDrive. Every longer timeframe (5 minutes up to
months and years) is built from these. Safe to stop and run again: it saves as it goes and only fetches what is missing. Usage: python intel/fetch_history.py"""
from __future__ import annotations

import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_crypto_lab as lab                   # noqa: E402
from engine.updown import ALL_COINS            # noqa: E402

YEARS = float(os.environ.get("HISTORY_YEARS", 4))   # a server without retraining only needs enough for the long view
FOLDER = lab.CACHE / "all"
COLS = ["t", "o", "h", "l", "c", "v", "tb"]
SAVE_EVERY = 200_000
PAUSE = 0.05       # stays far below Binance's limit, and leaves the live engine plenty of room


def _load(path: Path) -> pd.DataFrame:
    z = np.load(path)
    return pd.DataFrame({k: z[k] for k in COLS})


def seed(sym: str) -> pd.DataFrame | None:
    """What is already here, so nothing is fetched twice."""
    parts = [lab.CACHE / "long" / f"{sym}.npz", lab.CACHE / "unseen" / f"{sym}.npz", lab.CACHE / f"{sym}_1m.npz"]
    found = [_load(p) for p in parts if p.exists()]
    return pd.concat(found, ignore_index=True).drop_duplicates("t").sort_values("t", ignore_index=True) if found else None


def save(path: Path, df: pd.DataFrame) -> None:
    tmp = path.with_suffix(".tmp.npz")
    np.savez(tmp, **{k: df[k].to_numpy(dtype="float64") for k in COLS})
    tmp.replace(path)


def fetch(c: httpx.Client, sym: str, params: dict) -> list:
    for attempt in range(12):
        try:
            r = c.get("https://api.binance.com/api/v3/klines", params={"symbol": sym, "interval": "1m", "limit": 1000, **params})
            if r.status_code in (418, 429):
                time.sleep(int(r.headers.get("retry-after", 30)))
                continue
            return r.raise_for_status().json()
        except httpx.HTTPError:
            time.sleep(2 + attempt * 2)
    raise RuntimeError(f"{sym}: Binance did not answer")


def rows_of(data: list, now: int) -> list:
    return [(k[0], float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5]), float(k[9])) for k in data if k[6] < now]


def one(sym: str) -> None:
    FOLDER.mkdir(exist_ok=True)
    path = FOLDER / f"{sym}.npz"
    df = _load(path) if path.exists() else seed(sym)
    now = int(time.time() * 1000)
    start = now - int(YEARS * 365 * 86_400_000)
    with httpx.Client(timeout=25) as c:
        if df is None:
            df = pd.DataFrame(rows_of(fetch(c, sym, {"startTime": now - 86_400_000}), now), columns=COLS)
        # back to the start
        pending, end = [], int(df["t"].iat[0]) - 1
        while end > start:
            data = fetch(c, sym, {"endTime": end})
            if not data:
                break
            pending = rows_of(data, now) + pending
            end = data[0][0] - 1
            if len(pending) >= SAVE_EVERY:
                df = pd.concat([pd.DataFrame(pending, columns=COLS), df], ignore_index=True)
                save(path, df)
                pending = []
                print(f"{sym}: back to {pd.to_datetime(df['t'].iat[0], unit='ms'):%Y-%m-%d}, {len(df):,} candles", flush=True)
            time.sleep(PAUSE)
        if pending:
            df = pd.concat([pd.DataFrame(pending, columns=COLS), df], ignore_index=True)
        # any gap up to now
        begin = int(df["t"].iat[-1]) + 60_000
        fresh = []
        while begin < now - 60_000:
            data = fetch(c, sym, {"startTime": begin})
            if not data:
                break
            fresh += rows_of(data, now)
            begin = data[-1][0] + 60_000
            time.sleep(PAUSE)
        if fresh:
            df = pd.concat([df, pd.DataFrame(fresh, columns=COLS)], ignore_index=True)
    df = df.drop_duplicates("t").sort_values("t", ignore_index=True)
    save(path, df)
    gaps = int((df["t"].diff().dropna() != 60_000).sum())
    print(f"{sym}: DONE {len(df):,} candles from {pd.to_datetime(df['t'].iat[0], unit='ms'):%Y-%m-%d} to {pd.to_datetime(df['t'].iat[-1], unit='ms'):%Y-%m-%d}, {gaps} gaps in the record", flush=True)


if __name__ == "__main__":
    with ThreadPoolExecutor(2) as pool:
        for f in [pool.submit(one, s) for s in ALL_COINS]:
            f.result()
    print("ALL DONE", flush=True)
