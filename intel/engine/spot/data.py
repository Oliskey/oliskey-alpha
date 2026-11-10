"""Spot candles: load, validate, store. Real Binance spot data only.

Sources, in order of preference:
  1. Binance public REST (api.binance.com), the same feed the app already uses.
  2. The static-klines mirror (https://github.com/finom/static-klines): a daily community cache of Binance's
     public REST klines. Used when Binance is unreachable. It is not audit-grade: fine for research, never for
     settling trades.

Stored as intel/data/spot/<SYMBOL>_<tf>.csv.gz (gitignored). Every bar is a CLOSED bar: the last, still-forming
bar is dropped so a signal can never be decided on an unfinished candle.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
# Candles live on the permanent disk when there is one (Railway /data, Windows %LOCALAPPDATA%), else in the repo folder.
STORE = (Path(os.environ["LOCALAPPDATA"]) / "oliskey-alpha" / "spot") if os.environ.get("LOCALAPPDATA") \
    else ROOT / "intel" / "data" / "spot"
SYMBOLS = ("BTCUSDT", "ETHUSDT")
# Never used to design or test any AI Spot strategy before batch 3 (pre-registered in docs/intel/SPOT_HYPOTHESES.md).
UNSEEN = ("ADAUSDT", "AVAXUSDT", "BNBUSDT", "DOGEUSDT", "DOTUSDT", "LINKUSDT", "SOLUSDT", "XRPUSDT")
TIMEFRAMES = ("15m", "1h", "4h", "1d")
TF_MS = {"15m": 15 * 60_000, "1h": 3_600_000, "4h": 4 * 3_600_000, "1d": 86_400_000}
COLS = ["open", "high", "low", "close", "volume"]


@dataclass
class Quality:
    symbol: str
    timeframe: str
    bars: int = 0
    first: str = ""
    last: str = ""
    duplicates: int = 0
    gaps: int = 0
    missing_bars: int = 0
    bad_ohlc: int = 0
    unordered: int = 0
    problems: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        # Exchange maintenance leaves a few real gaps; more than 0.5% missing bars is not trusted.
        return self.bars > 0 and self.duplicates == 0 and self.bad_ohlc == 0 and self.unordered == 0 \
            and self.missing_bars <= 0.005 * max(self.bars, 1)


def frame_from_klines(rows: list[list], now_ms: int | None = None) -> pd.DataFrame:
    """Binance kline arrays -> DataFrame indexed by bar open time (UTC). Unfinished bars are dropped."""
    if not rows:
        return pd.DataFrame(columns=COLS, index=pd.DatetimeIndex([], tz="UTC"))
    a = np.array([[r[0], r[1], r[2], r[3], r[4], r[5], r[6]] for r in rows], dtype="float64")
    df = pd.DataFrame(a[:, 1:6], columns=COLS, index=pd.to_datetime(a[:, 0].astype("int64"), unit="ms", utc=True).as_unit("ns"))
    close_ms = a[:, 6]
    now = now_ms if now_ms is not None else pd.Timestamp.now(tz="UTC").value // 1_000_000
    df = df[close_ms < now]
    df.index.name = "open_time"
    return df


def load_mirror_dir(root: Path, symbol: str, tf: str) -> pd.DataFrame:
    """Read the static-klines cache folder (.klines-cache/<SYMBOL>/<tf>/*.json)."""
    parts = []
    for f in sorted((Path(root) / symbol / tf).glob("*.json")):
        rows = json.loads(f.read_text() or "[]")
        if rows:
            parts.append(frame_from_klines(rows))
    if not parts:
        return frame_from_klines([])
    df = pd.concat(parts)
    return df[~df.index.duplicated(keep="last")].sort_index()


def validate(df: pd.DataFrame, symbol: str, tf: str) -> Quality:
    q = Quality(symbol, tf, bars=len(df))
    if df.empty:
        q.problems.append("no bars")
        return q
    q.first, q.last = str(df.index[0]), str(df.index[-1])
    q.duplicates = int(df.index.duplicated().sum())
    ns = df.index.as_unit("ns").asi8
    q.unordered = int((np.diff(ns) <= 0).sum())
    step = TF_MS[tf] * 1_000_000
    d = np.diff(ns)
    q.gaps = int((d > step).sum())
    q.missing_bars = int(((d[d > step] // step) - 1).sum()) if q.gaps else 0
    bad = (df["high"] < df[["open", "close"]].max(axis=1)) | (df["low"] > df[["open", "close"]].min(axis=1)) \
        | (df[COLS[:4]] <= 0).any(axis=1) | df[COLS].isna().any(axis=1)
    q.bad_ohlc = int(bad.sum())
    for name in ("duplicates", "unordered", "bad_ohlc"):
        if getattr(q, name):
            q.problems.append(f"{name}={getattr(q, name)}")
    if q.missing_bars:
        q.problems.append(f"{q.gaps} gaps, {q.missing_bars} missing bars")
    return q


def save(df: pd.DataFrame, symbol: str, tf: str) -> Path:
    STORE.mkdir(parents=True, exist_ok=True)
    p = STORE / f"{symbol}_{tf}.csv.gz"
    df.to_csv(p, compression="gzip")
    return p


def load(symbol: str, tf: str) -> pd.DataFrame:
    p = STORE / f"{symbol}_{tf}.csv.gz"
    if not p.exists():
        raise FileNotFoundError(f"{p} missing: run python intel/fetch_spot_history.py first")
    df = pd.read_csv(p, index_col=0, parse_dates=True)
    df.index = pd.to_datetime(df.index, utc=True).as_unit("ns")
    return df[COLS].astype("float64")


def live_coins() -> list[str]:
    """The owner's live crypto list (intel/config/universe.yaml, not train-only), as Binance USDT symbols."""
    import yaml
    u = yaml.safe_load((ROOT / "intel" / "config" / "universe.yaml").read_text(encoding="utf-8"))
    return [a["symbol"] for a in u["assets"].values()
            if u["classes"][a["class"]].get("provider") == "binance" and not a.get("train_only")]
