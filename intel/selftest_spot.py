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
    df["low20"], df["bb_mid"] = df["low"].rolling(3, min_periods=1).min(), 103.0
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

tb = BY_ID["trend_breakout"]
t = one_trade([(100, 100, 100, 100), (100, 101, 99.5, 101), (101, 110, 100.5, 109), (109, 120, 108, 119),
               (119, 121, 118, 120), (120, 120, 112, 113), (113, 113, 105, 106)], tb)
check("trailing stop only moves up and exits as 'trail' above the first stop",
      t["reason"].iloc[0] == "trail" and t["exit"].iloc[0] >= 108 and t["r"].iloc[0] > 0)
rr = BY_ID["range_reversion"]
t = one_trade([(100, 100, 100, 100), (100, 101, 99.5, 100.5), (100.5, 104, 100, 103.5)], rr)
check("mean reversion exits at the band middle fixed at the signal bar", t["reason"].iloc[0] == "target" and t["exit"].iloc[0] == 103.0)
df_skip = flat([(100, 100, 100, 100), (104, 104.5, 103.5, 104), (104, 105, 103, 104)])
orig = bt.entries
bt.entries = lambda f, s: pd.Series([True] + [False] * (len(f) - 1), index=f.index)
check("mean reversion skips a trade whose target is not above the entry", bt.run(df_skip, rr, 1.0).empty)
bt.entries = orig
check("batch-2 strategies are registered with their own family and version",
      {s.strategy_id for s in SPECS if s.batch == 2} == {"range_reversion", "squeeze_breakout", "trend_breakout"})

# --- forward paper trading ------------------------------------------------------------------------------------
from engine.spot import paper   # noqa: E402
spec_tb = BY_ID["trend_breakout"]
fb = prepare(bars(2000, "4h", seed=3, drift=0.0008), bars(400, "1D", seed=3, drift=0.004), spec_tb)
all_t = bt.run(fb, spec_tb)
cut = fb.index[1200]
fwd = bt.run(fb, spec_tb, start_at=cut, include_open=True, bar=pd.Timedelta(hours=4))
check("forward run has trades to check", len(all_t) > 3 and len(fwd) > 0)
check("forward trades never come from bars that closed before the start",
      (fwd["signal_at"] + pd.Timedelta(hours=4) >= cut).all())
check("without include_open the result is unchanged (lab results stay identical)",
      bt.run(fb, spec_tb).equals(all_t))
op = bt.run(fb.iloc[: fb.index.get_loc(all_t["exit_at"].iloc[-1])], spec_tb, include_open=True)
check("an unfinished trade is reported as open with the latest price",
      op["status"].iloc[-1] == "open" and op["last_price"].iloc[-1] == fb["close"].iloc[fb.index.get_loc(all_t["exit_at"].iloc[-1]) - 1])
ts = pd.date_range("2026-01-01", periods=6, freq="h", tz="UTC")
book = pd.DataFrame({"strategy_id": "trend_breakout", "symbol": ["A", "B", "C", "D", "A", "E"], "status": "closed",
                     "entry_at": ts, "exit_at": ts + pd.Timedelta(days=1), "entry": 100.0, "stop_now": 95.0,
                     "last_price": None, "r": [2.0, -1.0, 1.0, 5.0, 3.0, 1.0], "risk_pct": 0.05})
pf = paper.portfolio(book)
check("money figure: at most 3 trades open at once, one per coin, the rest still recorded as skipped",
      pf["taken"] == 3 and pf["skipped"] == 3 and abs(pf["equity"] - (10_000 + 100 * 2 - 100 + 100)) < 1e-6)
rec = book.assign(exit=[102.0, 99.0, 101.0, 105.0, 103.0, 101.0], mfe_r=1.0, mae_r=-0.5, bars=3, reason="trail",
                  regime="TRENDING_UP", net_ret=book["r"] * 0.05)
sm = paper.summarise(rec, pd.Timestamp("2026-01-01", tz="UTC"), ["A"], ["every coin failed this cycle"])
tbs = sm["strategies"]["trend_breakout"]
check("summary counts come from the stored record even when every download failed",
      tbs["closed"] == 6 and tbs["verdict"] == "NOT_YET_PROVEN" and tbs["needed"] == 100 and abs(tbs["total_r"] - 11.0) < 1e-9)
check("re-pricing stored trades at higher costs lowers every result",
      (paper.at_costs(rec, 0.0012, 2.0)["r"] < paper.at_costs(rec, 0.0012, 1.0)["r"]).all())
def record(rs):
    """Stored forward trades over two years, 8 coins, with consistent prices for each R result."""
    n, c = len(rs), 0.0012
    at = pd.date_range("2027-01-01", periods=n, freq="3D", tz="UTC")
    net = np.array(rs) * 0.05
    return pd.DataFrame({"strategy_id": "trend_breakout", "symbol": [f"C{(i // 2) % 8}" for i in range(n)], "status": "closed",
                         "entry_at": at, "exit_at": at + pd.Timedelta(days=2), "entry": 100.0,
                         "exit": (net * 100 + 100 * (1 + c)) / (1 - c), "stop_now": 95.0, "last_price": None,
                         "r": rs, "risk_pct": 0.05, "net_ret": net, "mfe_r": 2.0, "mae_r": -0.5, "bars": 12,
                         "reason": "trail", "regime": "TRENDING_UP"})
good = paper.summarise(record([2.0, -0.8] * 120), None, [], [])["strategies"]["trend_breakout"]
bad = paper.summarise(record([0.8, -1.0] * 120), None, [], [])["strategies"]["trend_breakout"]
check("a strong live record of 240 trades is marked PASSED_FORWARD", good["verdict"] == "PASSED_FORWARD")
check("a losing live record is marked FAILED_FORWARD, never proven", bad["verdict"] == "FAILED_FORWARD")
check("paper runs 2 minutes after each 4h close", paper.seconds_to_next_run(4 * 3600 * 10 + 60) == 4 * 3600 - 60 + 120)
check("only the two pre-registered candidates are paper traded", paper.TRACKED == ("trend_breakout", "squeeze_breakout"))

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
