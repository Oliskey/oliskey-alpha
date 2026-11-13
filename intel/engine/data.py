"""Market data: Binance klines (crypto) and FMP daily bars (forex, indices, commodities), cached in Postgres.
The first run loads full history; later runs fetch only what is new."""
from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone

import re

import httpx
import pandas as pd

from . import db
from .settings import ASSETS, FMP_API_KEY, asset_cfg, variants


def redact(text: str) -> str:
    """Removes API keys from error text (FMP puts apikey=... in its URLs)."""
    return re.sub(r"(api_?key=)[^&\s'\"]+", r"\1***", text, flags=re.I)

BINANCE = "https://api.binance.com/api/v3/klines"
FMP_EOD = "https://financialmodelingprep.com/stable/historical-price-eod/full"
TF_MS = {"1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000}


def _frame(rows: list[tuple]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"])
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    return df.set_index("ts").sort_index()


def fetch_binance(symbol: str, tf: str, start_ms: int, client: httpx.Client, end_ms: int | None = None) -> pd.DataFrame:
    """Closed klines from start_ms to end_ms (default now; the still-forming bar is dropped)."""
    rows, frm = [], start_ms
    now_ms = int(time.time() * 1000)
    end = min(end_ms or now_ms, now_ms)
    while frm < end:
        r = client.get(BINANCE, params={"symbol": symbol, "interval": tf, "startTime": frm, "endTime": end, "limit": 1000})
        r.raise_for_status()
        data = r.json()
        if not data:
            break
        for k in data:
            if k[6] < now_ms:   # close time in the past = closed bar
                rows.append((k[0], float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])))
        frm = data[-1][0] + 1
        if len(data) < 1000:
            break
    return _frame([(pd.Timestamp(t, unit="ms", tz="UTC"), *rest) for t, *rest in rows]) if rows else _frame([])


def fetch_fmp_daily(symbol: str, since: str, client: httpx.Client) -> pd.DataFrame:
    """Daily bars since a date. Today's bar is dropped (not closed yet)."""
    r = client.get(FMP_EOD, params={"symbol": symbol, "from": since, "apikey": FMP_API_KEY})
    if r.status_code == 402:
        raise RuntimeError(f"FMP plan does not include {symbol}")
    r.raise_for_status()
    today = datetime.now(timezone.utc).date().isoformat()
    rows = [(pd.Timestamp(d["date"], tz="UTC"), d["open"], d["high"], d["low"], d["close"], d.get("volume") or 0)
            for d in r.json() if d["date"] < today]
    return _frame(rows)


def refresh(asset_ids: list[str] | None = None, providers: set[str] | None = None, log=print) -> dict[str, int]:
    """Fetch new closed bars for the given assets (default: all). Returns bars stored per asset."""
    stored: dict[str, int] = {}
    with httpx.Client(timeout=30) as client:
        for asset_id, cls in ((a, c) for a in (asset_ids or list(ASSETS)) for c in variants(a)):
            cfg = asset_cfg(asset_id, cls)
            if providers and cfg["provider"] not in providers:
                continue
            tf = cfg["timeframe"]
            last = db.last_bar_time(asset_id, tf)
            try:
                if cfg["provider"] == "binance":
                    # HISTORY_YEARS caps it on a server that does not retrain (Railway: 0.6, to fit the database plan); unset = config
                    years = min(cfg.get("history_years", 3), float(os.environ.get("HISTORY_YEARS", "inf")))
                    want = int((datetime.now(timezone.utc) - timedelta(days=365 * years)).timestamp() * 1000)
                    start = (int(last.timestamp() * 1000) + 1) if last else want
                    df = fetch_binance(cfg["symbol"], tf, start, client)
                    # History target raised (e.g. 3 -> 5 years): also fetch what lies before the oldest stored bar.
                    first = db.first_bar_time(asset_id, tf) if last else None
                    if first is not None and int(first.timestamp() * 1000) - want > 86_400_000:
                        older = fetch_binance(cfg["symbol"], tf, want, client, end_ms=int(first.timestamp() * 1000) - 1)
                        if len(older):
                            df = pd.concat([older, df])
                else:
                    since = (last - timedelta(days=3)).date().isoformat() if last else "2021-01-01"
                    df = fetch_fmp_daily(cfg["symbol"], since, client)
                stored[f"{asset_id}:{tf}"] = db.upsert_bars(asset_id, tf, df)
            except Exception as err:   # one failing market must not stop the others
                # Provider errors include the request URL; never let the API key reach the log.
                log(f"data {asset_id}: {redact(str(err))}")
                stored[f"{asset_id}:{tf}"] = 0
    return stored
