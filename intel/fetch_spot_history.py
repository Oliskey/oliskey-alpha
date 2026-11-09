"""Fetch BTC/USDT and ETH/USDT spot history for the AI Spot engine, validate it, and store it.

Usage:
  python intel/fetch_spot_history.py                 # Binance REST first, the static-klines mirror if Binance fails
  python intel/fetch_spot_history.py --mirror PATH   # use a local clone's .klines-cache folder (no network)

Writes intel/data/spot/<SYMBOL>_<tf>.csv.gz and prints a data-quality line per series. Exits 1 if any series fails.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine.spot.data import SYMBOLS, TF_MS, TIMEFRAMES, frame_from_klines, load_mirror_dir, save, validate  # noqa: E402

START = {"15m": "2024-12-30", "1h": "2022-01-01", "4h": "2017-08-17", "1d": "2017-08-17"}
MIRROR = "https://finom.github.io/static-klines/api/klines"


def from_binance(symbol: str, tf: str) -> pd.DataFrame:
    import httpx
    start = int(pd.Timestamp(START[tf], tz="UTC").value // 1_000_000)
    rows: list[list] = []
    with httpx.Client(timeout=20) as c:
        while True:
            r = c.get("https://api.binance.com/api/v3/klines",
                      params={"symbol": symbol, "interval": tf, "startTime": start, "limit": 1000})
            r.raise_for_status()
            batch = r.json()
            if not batch:
                break
            rows += batch
            start = batch[-1][0] + TF_MS[tf]
            if len(batch) < 1000:
                break
            time.sleep(0.15)
    return frame_from_klines(rows)


def from_mirror_web(symbol: str, tf: str) -> pd.DataFrame:
    import httpx
    with httpx.Client(timeout=30) as c:
        dates = c.get(f"{MIRROR}/start-dates/{tf}.json").json()
        parts = []
        for d in dates:
            if d > pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%d"):
                break
            rows = c.get(f"{MIRROR}/{tf}/{symbol}/{d}.json").json()
            if rows:
                parts.append(frame_from_klines(rows))
    df = pd.concat(parts)
    return df[~df.index.duplicated(keep="last")].sort_index()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mirror", help="path to a static-klines .klines-cache folder")
    args = ap.parse_args()
    failed = 0
    for sym in SYMBOLS:
        for tf in TIMEFRAMES:
            if args.mirror:
                df, src = load_mirror_dir(Path(args.mirror), sym, tf), "mirror (local)"
            else:
                try:
                    df, src = from_binance(sym, tf), "binance"
                except Exception as err:   # noqa: BLE001 - fall back, the reason is printed
                    print(f"  binance unavailable for {sym} {tf} ({type(err).__name__}); using the mirror")
                    df, src = from_mirror_web(sym, tf), "mirror (web)"
            q = validate(df, sym, tf)
            save(df, sym, tf)
            print(f"{'OK  ' if q.ok else 'FAIL'} {sym} {tf:>3} {q.bars:>7} bars {q.first[:10]} -> {q.last[:16]} "
                  f"src={src} {'; '.join(q.problems)}")
            failed += not q.ok
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
