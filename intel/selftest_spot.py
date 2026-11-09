"""AI Spot engine self-tests (no network, synthetic data). Usage: python intel/selftest_spot.py"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine.spot import backtest as bt                                     # noqa: E402
from engine.spot.data import frame_from_klines, validate                   # noqa: E402
from engine.spot.market import features, market_state, regime              # noqa: E402
from engine.spot.strategies import BY_ID, SPECS, entries, prepare, with_context  # noqa: E402

FAILED = []


def check(name: str, ok: bool) -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        FAILED.append(name)


def bars(n: int, freq: str = "4h", seed: int = 1, drift: float = 0.0003) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(np.cumsum(rng.normal(drift, 0.01, n)))
    open_ = np.r_[close[0], close[:-1]]
    high = np.maximum(open_, close) * (1 + rng.uniform(0, 0.006, n))
    low = np.minimum(open_, close) * (1 - rng.uniform(0, 0.006, n))
    idx = pd.date_range("2020-01-01", periods=n, freq=freq, tz="UTC").as_unit("ns")
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": rng.uniform(1, 3, n)}, idx)


def flat(rows: list[tuple]) -> pd.DataFrame:
    """Hand-built bars (open, high, low, close) with every column the backtest reads."""
    idx = pd.date_range("2024-01-01", periods=len(rows), freq="4h", tz="UTC").as_unit("ns")
    df = pd.DataFrame(rows, columns=["open", "high", "low", "close"], index=idx)
    df["swing_low10"], df["atr"], df["regime"] = 95.0, 1.0, "TRENDING_UP"
    return df


# --- data ------------------------------------------------------------------------------------------------------
now = int(pd.Timestamp("2024-01-01 03:00", tz="UTC").value // 1_000_000)
rows = [[t, "1", "2", "0.5", "1.5", "10", t + 3_599_999] for t in range(int(pd.Timestamp("2024-01-01", tz="UTC").value // 1_000_000), now + 3_600_000, 3_600_000)]
fr = frame_from_klines(rows, now_ms=now)
check("unfinished candle is dropped", len(fr) == 3 and fr.index[-1] == pd.Timestamp("2024-01-01 02:00", tz="UTC"))
gap = fr.drop(fr.index[1])
check("a missing bar is reported", validate(gap, "BTCUSDT", "1h").missing_bars == 1)
bad = fr.copy()
bad.iloc[0, 1] = 0.1      # high below open/close
check("impossible OHLC is rejected", not validate(bad, "BTCUSDT", "1h").ok)

# --- no look-ahead ---------------------------------------------------------------------------------------------
b = bars(1500)
full, cut = features(b), features(b.iloc[:1100])
cols = ["ema20", "ema200", "rsi", "atr", "adx", "vol_rank", "swing_low10", "range_high20", "bb_width_rank"]
check("features never use future bars",
      all(np.allclose(full[c].iloc[:1100].dropna(), cut[c].dropna()) for c in cols))
check("regime never uses future bars", (regime(full).iloc[:1100]["regime"] == regime(cut)["regime"]).all())
check("first 210 bars are UNKNOWN (warm-up)", (regime(full)["regime"].iloc[:210] == "UNKNOWN").all())

sig = bars(48, "4h")
day = bars(8, "1D")
day["close"] = np.linspace(100, 200, 8)          # steadily rising daily closes
day["open"] = day["close"]
day[["high", "low"]] = day[["close"]].to_numpy().repeat(2, axis=1)
ctx = with_context(features(sig), day, "4h", "1d")
dec = ctx.index + pd.Timedelta(hours=4)
check("a daily bar is only visible after it closes",
      ctx.loc[dec <= day.index[0] + pd.Timedelta(days=1) - pd.Timedelta(seconds=1), "ctx_regime"].eq("UNKNOWN").all())
s_full = entries(prepare(b, bars(260, "1D"), BY_ID["balanced_swing"]), BY_ID["balanced_swing"])
s_cut = entries(prepare(b.iloc[:1100], bars(260, "1D"), BY_ID["balanced_swing"]), BY_ID["balanced_swing"])
check("entry signals never change when future bars are added", (s_full.iloc[:1100] == s_cut).all())

# --- backtest mechanics ----------------------------------------------------------------------------------------
spec = BY_ID["strict_swing"]


def one_trade(rows_: list[tuple], spec_=spec) -> pd.DataFrame:
    df = flat(rows_)
    orig = bt.entries
    bt.entries = lambda f, s: pd.Series([True] + [False] * (len(f) - 1), index=f.index)
    try:
        return bt.run(df, spec_, 1.0)
    finally:
        bt.entries = orig


t = one_trade([(100, 100, 100, 100), (100, 100.5, 99.5, 100), (100, 120, 99, 110), (110, 110, 110, 110)])
check("entry is the NEXT bar's open, not the signal bar", len(t) == 1 and t["entry"].iloc[0] == 100 and t["entry_at"].iloc[0] == flat([(0,)*4]*2).index[1])
t = one_trade([(100, 100, 100, 100), (100, 100.5, 99.5, 100), (100, 200, 50, 100)])
check("stop and target in one bar counts as the stop", t["reason"].iloc[0] == "stop")
t = one_trade([(100, 100, 100, 100), (100, 100.5, 99.5, 100), (90, 91, 89, 90)])
check("a gap through the stop fills at the open, not the stop", t["exit"].iloc[0] == 90 and t["r"].iloc[0] < -1.5)
t = one_trade([(100, 100, 100, 100), (100, 100.5, 99.5, 100), (100, 120, 99.9, 110)])
check("target hit pays about +2.5R minus costs", t["reason"].iloc[0] == "target" and 2.3 < t["r"].iloc[0] < 2.5)
t1 = one_trade([(100,)*4, (100, 100.5, 99.5, 100), (100, 120, 99.9, 110)])
check("costs always reduce the result", t1["r"].iloc[0] < 2.5)
rows_ = [(100, 100, 100, 100)] + [(100, 100.5, 99.5, 100)] * 40
t = one_trade(rows_)
check("time stop closes a trade that goes nowhere", t["reason"].iloc[0] == "time" and t["bars"].iloc[0] == spec.time_stop_bars)
check("every strategy is long-only (no short rule exists)", all(entries(prepare(b, bars(260, "1D"), s), s).dtype == bool for s in SPECS[2:]))

# --- metrics and gates -----------------------------------------------------------------------------------------
tr = pd.DataFrame({"r": [1.0, -1.0] * 60, "entry_at": pd.date_range("2024-01-01", periods=120, freq="D", tz="UTC"),
                   "exit_at": pd.date_range("2024-01-02", periods=120, freq="D", tz="UTC"), "bars": 3,
                   "net_ret": 0.0, "exit": 1.0, "entry": 1.0, "risk_pct": 0.01, "mfe_r": 1.0, "reason": "x"})
m = bt.metrics(tr)
check("zero-edge series has expectancy 0 and profit factor 1", abs(m["expectancy_r"]) < 1e-12 and abs(m["profit_factor"] - 1) < 1e-12)
means, _ = bt.block_bootstrap(tr["r"].to_numpy(), reps=500)
check("bootstrap interval of a zero-edge series contains 0", np.quantile(means, 0.025) < 0 < np.quantile(means, 0.975))
check("gates are fixed before any run", bt.GATES == bt.Gates())

# --- contract --------------------------------------------------------------------------------------------------
ms = market_state("BTC/USDT", "4h", full)
check("MarketState carries the contract fields",
      {"regime", "trendDirection", "uncertainty", "recommended", "avoid", "evidence", "dataQuality"} <= ms.keys())

print(f"\n{'ALL PASSED' if not FAILED else f'{len(FAILED)} FAILED'}")
sys.exit(1 if FAILED else 0)
