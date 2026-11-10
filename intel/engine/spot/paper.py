"""AI Spot forward paper trading (protocol in docs/intel/SPOT_HYPOTHESES.md).

Two groups, each run after its bar closes: swing strategies on 4h bars (1d context) every 4 hours, scalps on 15m bars
(1h context) every 15 minutes. Each run refreshes Binance candles for the live coins, runs the SAME engine that was tested
(bt.run) from each strategy's tracking start, and stores the trades.
  * every strategy has its own record (all seven, approved or not: the evidence decides, not the label)
  * starts flat: only bars that close after tracking starts can open a trade
  * closed trades are frozen in the database; a later recalculation can never rewrite them
  * the paper ACCOUNT follows only what the agents decided to trade (engine/spot/agents.py)
No order is ever sent anywhere. Real money stays off (REAL-MONEY GATE).
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from engine.spot import backtest as bt
from engine.spot.data import STORE, TF_MS, frame_from_klines, live_coins, validate
from engine.spot.strategies import BY_ID, prepare

# Frozen 0.1.0 strategies by signal timeframe. trend_breakout / squeeze_breakout: forward protocol of batch 3. The others
# (batch 1 and 2) were added on 2026-11-10 under the batch-4 forward protocol in docs/intel/SPOT_HYPOTHESES.md.
GROUPS = {"4h": ("trend_breakout", "squeeze_breakout", "strict_swing", "balanced_swing", "range_reversion"),
          "15m": ("strict_scalp", "balanced_scalp")}
CONTEXT = {"4h": "1d", "15m": "1h"}
TRACKED = GROUPS["4h"] + GROUPS["15m"]
BATCH3 = ("trend_breakout", "squeeze_breakout")
# enough history for every indicator's warm-up (EMA200, 500-bar volatility rank)
PAPER_START = {"4h": "2023-01-01", "1d": "2021-01-01", "15m": "2026-09-01", "1h": "2026-06-01"}
START_EQUITY, RISK, MAX_OPEN = 10_000.0, 0.01, 3
BARS = {"4h": pd.Timedelta(hours=4), "15m": pd.Timedelta(minutes=15)}
BAR = BARS["4h"]
MIN_FORWARD_TRADES = bt.GATES.min_trades


# ---- candles -----------------------------------------------------------------------------------------------------
def _read(symbol: str, tf: str) -> pd.DataFrame | None:
    p = STORE / f"{symbol}_{tf}.csv.gz"
    if not p.exists():
        return None
    df = pd.read_csv(p, index_col=0, parse_dates=True)
    df.index = pd.to_datetime(df.index, utc=True).as_unit("ns")
    return df[["open", "high", "low", "close", "volume"]].astype("float64")


def update_candles(symbol: str, tf: str, client) -> pd.DataFrame:
    """Append closed Binance bars to the stored series (full download from PAPER_START the first time)."""
    old = _read(symbol, tf)
    start = (int(old.index[-1].value // 1_000_000) + TF_MS[tf]) if old is not None and len(old) \
        else int(pd.Timestamp(PAPER_START[tf], tz="UTC").value // 1_000_000)
    rows: list[list] = []
    while True:
        r = client.get("https://api.binance.com/api/v3/klines",
                       params={"symbol": symbol, "interval": tf, "startTime": start, "limit": 1000})
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        rows += batch
        start = batch[-1][0] + TF_MS[tf]
        if len(batch) < 1000:
            break
        time.sleep(0.1)
    new = frame_from_klines(rows)
    df = new if old is None else pd.concat([old, new])
    df = df[~df.index.duplicated(keep="last")].sort_index()
    STORE.mkdir(parents=True, exist_ok=True)
    df.to_csv(STORE / f"{symbol}_{tf}.csv.gz", compression="gzip")
    return df


# ---- trades ------------------------------------------------------------------------------------------------------
def forward_trades(sig: pd.DataFrame, ctx: pd.DataFrame, sid: str, started_at: pd.Timestamp) -> pd.DataFrame:
    """The strategy's trades from started_at on (closed, plus the one still open)."""
    spec = BY_ID[sid]
    return bt.run(prepare(sig, ctx, spec), spec, 1.0, start_at=started_at, include_open=True, bar=BARS[spec.timeframe])


def at_costs(closed: pd.DataFrame, cost_per_side: float, mult: float) -> pd.DataFrame:
    """The same stored trades re-priced at mult x costs (the formula bt.run uses)."""
    if closed.empty:
        return closed
    c = cost_per_side * mult
    out = closed.copy()
    out["net_ret"] = (out["exit"] * (1 - c) - out["entry"] * (1 + c)) / out["entry"]
    out["r"] = out["net_ret"] / out["risk_pct"]
    return out


def portfolio(trades: pd.DataFrame) -> dict:
    """Virtual account: 1% of equity per trade, max 3 open, one position per coin. Others still count as evidence."""
    equity, open_, taken, skipped, realised = START_EQUITY, [], [], 0, 0.0
    if trades.empty:
        return {"start": START_EQUITY, "equity": START_EQUITY, "realised": 0.0, "unrealised": 0.0, "taken": 0,
                "skipped": 0, "open": []}
    for _, t in trades.sort_values("entry_at").iterrows():
        for o in [o for o in open_ if o["status"] == "closed" and o["exit_at"] <= t["entry_at"]]:
            pnl = o["risk_amount"] * o["r"]
            equity += pnl
            realised += pnl
            open_.remove(o)
        if len(open_) >= MAX_OPEN or any(o["symbol"] == t["symbol"] for o in open_):
            skipped += 1
            continue
        row = {**t.to_dict(), "risk_amount": equity * RISK}
        open_.append(row)
        taken.append(row)
    unrealised, still_open = 0.0, []
    for o in sorted(open_, key=lambda o: o["entry_at"]):
        if o["status"] == "closed":
            equity += o["risk_amount"] * o["r"]
            realised += o["risk_amount"] * o["r"]
        else:
            cost = BY_ID[o["strategy_id"]].cost_per_side
            r_now = (o["last_price"] * (1 - cost) - o["entry"] * (1 + cost)) / (o["entry"] * o["risk_pct"])
            unrealised += o["risk_amount"] * r_now
            still_open.append({"strategy": o["strategy_id"], "symbol": o["symbol"], "entry": o["entry"],
                               "stop": o["stop_now"], "price": o["last_price"], "r_now": round(r_now, 3),
                               "risk_amount": round(o["risk_amount"], 2), "since": str(o["entry_at"])})
    return {"start": START_EQUITY, "equity": round(equity + unrealised, 2), "realised": round(realised, 2),
            "unrealised": round(unrealised, 2), "taken": len(taken), "skipped": skipped, "open": still_open}


def verdict(by_symbol: dict[str, tuple], sid: str = "trend_breakout") -> dict:
    """Forward gate on the stored record: NOT_YET_PROVEN below 100 closed trades, then the batch-3 gates.
    Bonferroni count as pre-registered: 2 for the batch-3 pair, 5 for the batch-4 group."""
    n = sum(len(v[0]) for v in by_symbol.values())
    if n < MIN_FORWARD_TRADES:
        return {"verdict": "NOT_YET_PROVEN", "needed": MIN_FORWARD_TRADES}
    r = bt.pooled({s: v for s, v in by_symbol.items() if len(v[0])}, n_tests=len(BATCH3) if sid in BATCH3 else len(TRACKED) - len(BATCH3))
    return {"verdict": "PASSED_FORWARD" if r["verdict"] == "APPROVED_FOR_PAPER" else "FAILED_FORWARD",
            "needed": MIN_FORWARD_TRADES, "gate_checks": r.get("checks", {}),
            "expectancy_low": r.get("confidence", {}).get("expectancy_low")}


def summarise(trades: pd.DataFrame, started: pd.Timestamp | None, coins: list[str], errors: list[str],
              account: dict | None = None) -> dict:
    """Everything shown to the user comes from the stored (frozen) trades, never from one cycle's downloads.
    account: the agents' paper account (agents.account); without it, every strategy trade counts (lab view)."""
    out = {"updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "started_at": None if started is None else started.isoformat(), "coins": coins, "errors": errors,
           "rules": "same engine as the lab; next-bar-open fills; stop first; 0.12% costs per side",
           "real_money": False, "strategies": {}, "account": account if account is not None else portfolio(trades)}
    for sid in TRACKED:
        t = trades[trades["strategy_id"] == sid] if not trades.empty else trades
        closed = t[t["status"] == "closed"] if not t.empty else t
        r = closed["r"] if not closed.empty else pd.Series(dtype=float)
        cost = BY_ID[sid].cost_per_side
        by_symbol = {sym: (g, at_costs(g, cost, 1.5), at_costs(g, cost, 2.0))
                     for sym, g in closed.groupby("symbol")} if not closed.empty else {}
        out["strategies"][sid] = {
            "version": BY_ID[sid].version, "style": BY_ID[sid].style, "timeframe": BY_ID[sid].timeframe,
            "closed": int(len(closed)), "open": int(len(t) - len(closed)),
            "wins": int((r > 0).sum()), "win_rate": float((r > 0).mean()) if len(r) else None,
            "expectancy_r": float(r.mean()) if len(r) else None, "total_r": float(r.sum()) if len(r) else 0.0,
            **verdict(by_symbol, sid)}
    return out


# ---- the cycle ---------------------------------------------------------------------------------------------------
UPSERT = """
insert into intel.spot_paper_trades (id, strategy_id, version, symbol, timeframe, status, signal_at, entry_at, entry,
  stop0, stop_now, target, last_price, exit_at, exit, reason, r, mfe_r, mae_r, bars, regime, updated_at)
values (%(id)s, %(strategy_id)s, %(version)s, %(symbol)s, %(timeframe)s, %(status)s, %(signal_at)s, %(entry_at)s, %(entry)s,
  %(stop0)s, %(stop_now)s, %(target)s, %(last_price)s, %(exit_at)s, %(exit)s, %(reason)s, %(r)s, %(mfe_r)s, %(mae_r)s,
  %(bars)s, %(regime)s, now())
on conflict (id) do update set status = excluded.status, stop_now = excluded.stop_now, last_price = excluded.last_price,
  exit_at = excluded.exit_at, exit = excluded.exit, reason = excluded.reason, r = excluded.r, mfe_r = excluded.mfe_r,
  mae_r = excluded.mae_r, bars = excluded.bars, updated_at = now()
where intel.spot_paper_trades.status = 'open'      -- a closed trade is frozen
"""


def _clean(v):
    """Database-safe value: NaN/NaT/inf become NULL, numpy and pandas types become plain Python."""
    if v is None or v is pd.NaT:
        return None
    if isinstance(v, (pd.Timestamp, datetime, np.datetime64)):
        return None if pd.isna(v) else pd.Timestamp(v).to_pydatetime()
    if isinstance(v, (float, np.floating)):
        return float(v) if np.isfinite(v) else None
    if isinstance(v, np.integer):
        return int(v)
    return v


def cycle(conn, client, coins: list[str] | None = None, tf: str = "4h", decide=None) -> dict:
    """One run for one group. decide(conn, client, frames, tf) is the agents' step (agents.decide), given the fresh candles."""
    coins = coins or live_coins()
    errors: list[str] = []
    rows: list[dict] = []
    frames: dict[str, tuple[pd.DataFrame, pd.DataFrame]] = {}
    for sym in coins:
        try:
            sig, ctx = update_candles(sym, tf, client), update_candles(sym, CONTEXT[tf], client)
            q4, q1 = validate(sig, sym, tf), validate(ctx, sym, CONTEXT[tf])
            if not (q4.ok and q1.ok):
                raise ValueError(f"data quality: {q4.problems + q1.problems}")
        except Exception as err:          # noqa: BLE001 - one coin's failure must not stop the others
            errors.append(f"{sym}: {type(err).__name__}: {str(err)[:120]}")
            continue
        frames[sym] = (sig, ctx)
        for sid in GROUPS[tf]:
            spec = BY_ID[sid]
            conn.execute("insert into intel.spot_paper_tracking (strategy_id, version, symbol) values (%s, %s, %s) "
                         "on conflict do nothing", (sid, spec.version, sym))
            started = conn.execute("select started_at from intel.spot_paper_tracking where strategy_id = %s and "
                                   "version = %s and symbol = %s", (sid, spec.version, sym)).fetchone()[0]
            ft = forward_trades(sig, ctx, sid, pd.Timestamp(started))
            for _, t in ft.iterrows():
                rows.append({"last_price": None, "stop_now": None,
                             **{k: _clean(v) for k, v in t.to_dict().items()}, "strategy_id": sid,
                             "version": spec.version, "symbol": sym, "timeframe": spec.timeframe,
                             "id": f"{sid}|{spec.version}|{sym}|{t['signal_at'].isoformat()}"})
    for row in rows:
        conn.execute(UPSERT, row)
    if decide is not None:
        try:
            decide(conn, client, frames, tf)
        except Exception as err:          # noqa: BLE001 - the strategy records above are kept even if the agents fail
            errors.append(f"agents: {type(err).__name__}: {str(err)[:160]}")
    return write_summary(conn, coins, errors)


def write_summary(conn, coins: list[str], errors: list[str]) -> dict:
    cols = ["strategy_id", "symbol", "status", "entry_at", "exit_at", "entry", "exit", "stop_now", "last_price", "r",
            "mfe_r", "mae_r", "bars", "reason", "regime", "risk_pct"]
    stored = pd.DataFrame(conn.execute(
        "select strategy_id, symbol, status, entry_at, exit_at, entry, exit, stop_now, last_price, r, mfe_r, mae_r, bars, "
        "reason, regime, (entry - stop0) / entry as risk_pct from intel.spot_paper_trades").fetchall(), columns=cols)
    if not stored.empty:
        stored["net_ret"] = stored["r"] * stored["risk_pct"]
    started = conn.execute("select min(started_at) from intel.spot_paper_tracking").fetchone()[0]
    from engine.spot import agents                     # late import: agents imports this module
    s = summarise(stored, None if started is None else pd.Timestamp(started), coins, errors, agents.account(conn, stored))
    s.update(agents.overview(conn, stored))
    conn.execute("insert into intel.spot_paper_summary (id, summary) values ('latest', %s) on conflict (id) do update "
                 "set summary = excluded.summary, updated_at = now()", (json.dumps(s, default=str),))
    return s


def seconds_to_next_run(now: float | None = None, delay: int = 120, period: int = 4 * 3600) -> float:
    """Bars close on the period grid (4h: 00:00, 04:00, ... UTC; 15m: :00, :15, ...); run `delay` seconds after each close."""
    now = time.time() if now is None else now
    return (period - (now % period)) + delay
