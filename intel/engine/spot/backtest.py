"""Cost-aware backtest for long-only spot strategies, with walk-forward folds, bootstrap and promotion gates.

Rules that keep it honest (docs/spot/SPEC.md Part F):
  * decided at bar close, filled at the NEXT bar's open; never at the signal price
  * if stop and target are both inside one bar, the STOP is assumed first
  * a gap through the stop fills at the bar's open (worse than the stop), never at the stop
  * fees + spread + slippage on both sides, and every result is re-run at 1.5x and 2x costs
  * one open position per strategy and symbol
  * the gates are written below, before any run, and are never loosened after seeing a result
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from engine.spot.strategies import Spec, entries, stop_price

RISK_PER_TRADE = 0.01      # 1% of equity per trade for the equity curve (illustrative, as in the spec)


def run(f: pd.DataFrame, spec: Spec, cost_mult: float = 1.0, start_at: pd.Timestamp | None = None,
        include_open: bool = False, bar: pd.Timedelta | None = None, exit_on: str | None = None) -> pd.DataFrame:
    """One row per closed trade: times, prices, net R, MFE/MAE in R, bars held, exit reason, regime at entry.

    start_at (forward paper trading): ignore every signal whose bar closed before start_at, so the strategy starts flat.
    include_open: also return the trade still open at the last bar (status 'open', current stop, no exit).
    exit_on: an extra exit being cross-tested by the improvement registry (never used by a frozen strategy's record).
      "regime_down" = leave at the bar's close once that bar's regime is TRENDING_DOWN."""
    sig = entries(f, spec).to_numpy()
    if start_at is not None:
        closes = f.index + (bar if bar is not None else (f.index[1] - f.index[0]))
        sig = sig & (closes >= start_at)
    o, h, l, c = (f[k].to_numpy() for k in ("open", "high", "low", "close"))
    cost = spec.cost_per_side * cost_mult
    idx, regimes = f.index, f["regime"].to_numpy()
    low20 = f["low20"].to_numpy() if spec.trail == "low20" else None
    trades, i, n = [], 0, len(f)
    while i < n - 1:
        if not sig[i]:
            i += 1
            continue
        e_i = i + 1
        entry = o[e_i]
        stop = stop_price(f.iloc[i], entry, spec)
        risk = entry - stop
        if not np.isfinite(stop) or risk <= 0:
            i += 1
            continue
        if spec.target_mode == "bb_mid":
            target = float(f["bb_mid"].iloc[i])
            if not target > entry * (1 + 2 * cost):     # nothing to gain after costs: skip, as pre-registered
                i += 1
                continue
        elif spec.target_mode == "none":
            target = np.inf
        else:
            target = entry + spec.target_r * risk
        protected = False
        mfe = mae = 0.0
        exit_px, reason, j = None, None, e_i
        while j < n:
            # 1) stop first (gap-aware)
            if l[j] <= stop:
                exit_px, reason = (o[j] if o[j] < stop else stop), ("breakeven" if protected else ("trail" if stop > entry - risk else "stop"))
                mae = min(mae, (min(l[j], exit_px) - entry) / risk)
                break
            # 2) target (a gap above the target fills at the open, which is better: still capped at open)
            if h[j] >= target:
                exit_px, reason = (o[j] if o[j] > target else target), "target"
                mfe = max(mfe, (h[j] - entry) / risk)
                break
            mfe = max(mfe, (h[j] - entry) / risk)
            mae = min(mae, (l[j] - entry) / risk)
            held = j - e_i + 1
            # 2b) cross-tested extra exit, at the bar's close (known then)
            if exit_on == "regime_down" and regimes[j] == "TRENDING_DOWN":
                exit_px, reason = c[j], "regime"
                break
            # 3) time stop at the bar's close
            if held >= spec.time_stop_bars and (c[j] - entry) / risk < spec.time_stop_min_r:
                exit_px, reason = c[j], "time"
                break
            # 4) TRAIL: the stop moves up to the 20-bar low (known at this bar's close), used from the next bar
            if low20 is not None and np.isfinite(low20[j]) and low20[j] > stop:
                stop = low20[j]
            # 5) PROTECT: once +1R was reached, the stop moves to break-even (incl. costs) from the next bar
            if not protected and spec.target_mode == "r" and spec.target_r > 1.0 and h[j] >= entry + risk:
                stop = entry * (1 + 2 * cost)
                protected = True
            j += 1
        if exit_px is None:          # data ended with the trade open: no result yet
            if include_open:
                trades.append({"signal_at": idx[i], "entry_at": idx[e_i], "exit_at": pd.NaT, "entry": entry,
                               "stop0": entry - risk, "target": target, "exit": np.nan, "reason": None, "r": np.nan,
                               "net_ret": np.nan, "risk_pct": risk / entry, "mfe_r": mfe, "mae_r": mae,
                               "bars": n - e_i, "regime": regimes[i], "status": "open", "stop_now": stop,
                               "last_price": c[n - 1]})
            break
        net_ret = (exit_px * (1 - cost) - entry * (1 + cost)) / entry
        r = net_ret / (risk / entry)
        trades.append({"signal_at": idx[i], "entry_at": idx[e_i], "exit_at": idx[j], "entry": entry, "stop0": entry - risk,
                       "target": target, "exit": exit_px, "reason": reason, "r": r, "net_ret": net_ret,
                       "risk_pct": risk / entry, "mfe_r": mfe, "mae_r": mae, "bars": j - e_i + 1,
                       "regime": regimes[i], "status": "closed", "stop_now": stop})
        i = j + 1                     # next signal only after this trade is closed
    return pd.DataFrame(trades)


def equity_curve(t: pd.DataFrame, risk: float = RISK_PER_TRADE) -> pd.Series:
    if t.empty:
        return pd.Series(dtype=float)
    return pd.Series(np.cumprod(1 + risk * t["r"].to_numpy()), index=pd.DatetimeIndex(t["exit_at"]))


def max_drawdown(eq: pd.Series) -> float:
    if eq.empty:
        return 0.0
    v = np.r_[1.0, eq.to_numpy()]
    return float(1 - (v / np.maximum.accumulate(v)).min())


def metrics(t: pd.DataFrame) -> dict:
    if t.empty:
        return {"trades": 0}
    r = t["r"]
    wins, losses = r[r > 0], r[r <= 0]
    eq = equity_curve(t)
    daily = eq.resample("1D").last().ffill()
    dret = daily.pct_change().dropna()
    years = max((t["exit_at"].max() - t["entry_at"].min()).days / 365.25, 1 / 365)
    cagr = eq.iloc[-1] ** (1 / years) - 1
    dd = max_drawdown(eq)
    sd, dsd = dret.std(), dret[dret < 0].std()
    return {
        "trades": int(len(t)), "win_rate": float((r > 0).mean()), "avg_win_r": float(wins.mean()) if len(wins) else 0.0,
        "avg_loss_r": float(losses.mean()) if len(losses) else 0.0, "expectancy_r": float(r.mean()),
        "profit_factor": float(wins.sum() / -losses.sum()) if losses.sum() < 0 else float("inf"),
        "net_return_pct": float((eq.iloc[-1] - 1) * 100), "max_drawdown_pct": float(dd * 100),
        "sharpe": float(dret.mean() / sd * np.sqrt(365)) if sd and sd > 0 else 0.0,
        "sortino": float(dret.mean() / dsd * np.sqrt(365)) if dsd and dsd > 0 else 0.0,
        "calmar": float(cagr / dd) if dd > 0 else 0.0, "avg_bars_held": float(t["bars"].mean()),
        "trades_per_month": float(len(t) / (years * 12)),
        "avg_cost_r": float((((t["exit"] - t["entry"]) / t["entry"] - t["net_ret"]) / t["risk_pct"]).mean()),
        "capture_ratio": float((r[r > 0] / t.loc[r > 0, "mfe_r"].clip(lower=1e-9)).mean()) if len(wins) else 0.0,
        "exits": t["reason"].value_counts().to_dict(),
    }


def block_bootstrap(r: np.ndarray, reps: int = 4000, block: int = 5, seed: int = 7) -> tuple[np.ndarray, np.ndarray]:
    """Resampled expectancies and max drawdowns (blocks keep streaks together)."""
    rng = np.random.default_rng(seed)
    n = len(r)
    nb = int(np.ceil(n / block))
    means, dds = np.empty(reps), np.empty(reps)
    for k in range(reps):
        starts = rng.integers(0, max(n - block + 1, 1), nb)
        sample = np.concatenate([r[s:s + block] for s in starts])[:n]
        means[k] = sample.mean()
        eq = np.cumprod(1 + RISK_PER_TRADE * sample)
        v = np.r_[1.0, eq]
        dds[k] = 1 - (v / np.maximum.accumulate(v)).min()
    return means, dds


def folds(t: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp, k: int = 6) -> list[dict]:
    """Fixed rules evaluated on k equal, consecutive time windows (walk-forward over the whole history)."""
    edges = pd.date_range(start, end, periods=k + 1)
    out = []
    for a, b in zip(edges[:-1], edges[1:]):
        part = t[(t["entry_at"] >= a) & (t["entry_at"] < b)] if not t.empty else t
        out.append({"from": str(a.date()), "to": str(b.date()), "trades": int(len(part)),
                    "expectancy_r": float(part["r"].mean()) if len(part) else None})
    return out


@dataclass(frozen=True)
class Gates:
    """Pre-registered on 2026-11-09, before the first run. Never loosened after seeing results."""
    min_trades: int = 100
    alpha: float = 0.05              # two-sided, divided by the number of strategy x symbol tests (Bonferroni)
    min_fold_share: float = 0.70     # share of folds with >= 10 trades that are profitable
    max_dd_p95_pct: float = 25.0     # bootstrap 95th percentile drawdown at 1% risk per trade
    sealed_share: float = 0.20       # the most recent 20% of the history is the sealed test


GATES = Gates()


def judge(t1: pd.DataFrame, t15: pd.DataFrame, t2: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp,
          n_tests: int) -> dict:
    """The fixed gates applied to one set of closed trades (one coin, or several pooled in exit order)."""
    m1 = metrics(t1)
    fl = folds(t1, start, end)
    sealed_from = start + (end - start) * (1 - GATES.sealed_share)
    sealed = t1[t1["entry_at"] >= sealed_from] if not t1.empty else t1
    out = {"period": [str(start), str(end)], "metrics_1x": m1,
           "metrics_1_5x": metrics(t15), "metrics_2x": metrics(t2), "folds": fl,
           "sealed_test": {"from": str(sealed_from), **metrics(sealed)},
           "by_regime": (t1.groupby("regime")["r"].agg(["count", "mean"]).round(3).to_dict("index")
                         if not t1.empty else {})}
    checks = {}
    if m1["trades"] < GATES.min_trades:
        out.update(verdict="MORE_DATA", checks={f"at least {GATES.min_trades} trades (has {m1.get('trades', 0)})": False})
        return out
    q = GATES.alpha / n_tests / 2
    means, dds = block_bootstrap(t1["r"].to_numpy())
    lo, hi = np.quantile(means, [q, 1 - q])
    dd95 = float(np.quantile(dds, 0.95) * 100)
    used = [x for x in fl if x["trades"] >= 10]
    fold_share = sum(x["expectancy_r"] > 0 for x in used) / len(used) if used else 0.0
    out["confidence"] = {"expectancy_low": float(lo), "expectancy_high": float(hi), "level": 1 - 2 * q,
                         "max_dd_p95_pct": dd95}
    checks["expectancy lower bound > 0 (1x costs)"] = bool(lo > 0)
    checks["expectancy > 0 at 1.5x costs"] = bool(out["metrics_1_5x"].get("expectancy_r", -1) > 0)
    checks[f">= {GATES.min_fold_share:.0%} of folds profitable"] = bool(fold_share >= GATES.min_fold_share)
    checks["sealed test (last 20%) expectancy > 0"] = bool(out["sealed_test"].get("expectancy_r", -1) > 0)
    checks[f"bootstrap 95th pct drawdown <= {GATES.max_dd_p95_pct:.0f}%"] = bool(dd95 <= GATES.max_dd_p95_pct)
    out["checks"] = checks
    out["fold_share"] = fold_share
    out["verdict"] = "APPROVED_FOR_PAPER" if all(checks.values()) else "REJECTED"
    return out


def evaluate(f: pd.DataFrame, spec: Spec, n_tests: int) -> dict:
    out = judge(run(f, spec, 1.0), run(f, spec, 1.5), run(f, spec, 2.0), f.index[0], f.index[-1], n_tests)
    return {"spec": spec.as_dict(), **out}


def pooled(by_symbol: dict[str, tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]], n_tests: int,
           min_positive_share: float = 5 / 8) -> dict:
    """One test over several coins: each coin's trades at 1x, 1.5x and 2x costs, pooled in exit order.
    Adds a breadth rule so one lucky coin cannot carry the result."""
    def pool(k: int) -> pd.DataFrame:
        parts = [v[k].assign(symbol=s) for s, v in by_symbol.items() if not v[k].empty]
        return pd.concat(parts).sort_values("exit_at").reset_index(drop=True) if parts else pd.DataFrame()
    t1 = pool(0)
    start = min(v[0]["entry_at"].min() for v in by_symbol.values() if not v[0].empty)
    end = max(v[0]["exit_at"].max() for v in by_symbol.values() if not v[0].empty)
    out = judge(t1, pool(1), pool(2), start, end, n_tests)
    per = {s: {"trades": int(len(v[0])), "expectancy_r": float(v[0]["r"].mean()) if len(v[0]) else None}
           for s, v in by_symbol.items()}
    out["per_symbol"] = per
    with_trades = [x for x in per.values() if x["trades"]]
    share = sum(x["expectancy_r"] > 0 for x in with_trades) / len(with_trades) if with_trades else 0.0
    out["positive_share"] = share
    if out["verdict"] != "MORE_DATA":
        out["checks"][f"at least {min_positive_share:.0%} of coins profitable"] = bool(share >= min_positive_share)
        out["verdict"] = "APPROVED_FOR_PAPER" if all(out["checks"].values()) else "REJECTED"
    return out
