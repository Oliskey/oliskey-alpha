"""AI Spot agents: the 13 responsibilities of docs/spot/SPEC.md (plus News & Event Risk), run on every closed bar of every
live coin. Each agent gives a view (PASS / WAIT / BLOCK / INFO) with a plain reason; the decision and every view are stored
frozen in intel.spot_agent_decisions, and the paper account follows only TRADE decisions.

What they are, honestly: deterministic services with fixed, written rules - not language models and not self-modifying.
  * Nothing here can place a real order. The only "execution" is a paper record that follows a strategy trade by id.
  * The Risk agent is plain arithmetic and runs on every proposal; no other agent can skip or override it.
  * Behaviour changes only through the improvement registry (improvements.py): a rule is applied only while its
    registry status is "deployed", every status change is logged, and nothing an agent "believes" can deploy it.
  * Every input is from the closed bar and earlier (news: published and seen before the decision), so the record can be
    checked later for look-ahead.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from psycopg.types.json import Jsonb

from engine.spot import backtest as bt
from engine.spot import improvements as imp
from engine.spot import paper
from engine.spot.data import ROOT
from engine.spot.market import RECOMMEND, market_state
from engine.spot.strategies import BY_ID, entries, prepare, stop_price

# ---- who does what (shown in the app) ------------------------------------------------------------------------------
AGENTS = [
    ("market", "Market Intelligence", "Reads trend, strength, volatility, liquidity and momentum on the closed bar and names the regime.",
     "Every strategy works only in some markets. Knowing the regime first stops a good strategy being used in the wrong market."),
    ("news", "News & Event Risk", "Counts the latest headlines on the coin and the whole market and spots a clash with a long trade.",
     "A clean chart signal during bad news is a trap. When chart and news disagree, the safe move is to wait, not to force a trade."),
    ("discovery", "Strategy Discovery", "Keeps the list of written, pre-registered strategy ideas and new research leads.",
     "New ideas are written down before testing, so results cannot be bent to fit afterwards."),
    ("testing", "Strategy Testing", "Holds each strategy's lab verdict (walk-forward, bootstrap, costs, sealed test) and its live paper record.",
     "Only evidence decides. A strategy that only looks good on the data it was built on is rejected."),
    ("selection", "Strategy Selection", "Picks which strategy may act on this coin now: signal present, approved by testing, healthy, suited to the regime.",
     "Several strategies can fire at once. Choosing the one with the best proven record avoids weak or untested ones."),
    ("allocation", "Strategy Allocation", "Decides how much of the account each chosen strategy may risk (full, half or none).",
     "Healthy strategies get their normal share; strategies in a losing spell get less, so one bad run cannot sink the account."),
    ("entry", "Entry Timing", "Checks the candle is closed, the signal is fresh, the price has not run away, and the spread is acceptable.",
     "A late or chased entry turns a winning plan into a loser. Waiting for a confirmed, fresh signal protects the edge."),
    ("duration", "Trade Duration", "Says how long trades of this kind usually last and when the time exit applies; watches open trades for a weakened thesis.",
     "Scalps and swings need different patience. Knowing the normal holding time shows when a trade is overstaying."),
    ("exit", "Exit Intelligence", "Sets the stop, the target or trailing stop and the break-even move before the trade starts.",
     "Every trade has its way out decided in advance, so emotions or hope never decide the exit."),
    ("risk", "Risk Manager", "Fixed arithmetic: 1% per trade, 3% open, 3% daily loss, 10% drawdown, 3 positions, correlated exposure, kill switch.",
     "This is the guard no other agent can talk past. If anything is missing or a limit is reached, the answer is no."),
    ("execution", "Execution", "Turns an approved decision into one paper order with costs, a protective stop and a fixed id that cannot repeat.",
     "One signal, one order: a retry or restart can never open the same trade twice."),
    ("learning", "Performance Learning", "Scores every strategy and every veto against what really happened afterwards.",
     "Agents must prove their help: a veto that keeps blocking winning trades is found and removed."),
    ("recovery", "Strategy Recovery", "Puts a strategy on watch or pauses it after a losing spell, and brings it back when its record recovers.",
     "A broken strategy stops costing money quickly, and a recovered one is not left out forever."),
    ("collaboration", "Collaborative Intelligence", "Combines every view into TRADE or NO TRADE and runs the shared improvement registry.",
     "No single agent decides alone: a trade happens only when the needed agents agree and none blocks it."),
]
NAMES = {k: n for k, n, _, _ in AGENTS}
STRATEGY = {"trend_breakout": "Trend breakout", "squeeze_breakout": "Squeeze breakout", "strict_swing": "Strict swing",
            "balanced_swing": "Balanced swing", "range_reversion": "Range reversion", "strict_scalp": "Strict scalp",
            "balanced_scalp": "Balanced scalp"}
nice = lambda sid: STRATEGY.get(sid, sid)
coin = lambda sym: sym[:-4] if sym.endswith("USDT") else sym

# ---- fixed limits (mirror backend/src/spot/risk.js DEFAULT_LIMITS) --------------------------------------------------
LIMITS = {"risk_per_trade": 0.01, "max_open_risk": 0.03, "max_daily_loss": 0.03, "max_drawdown": 0.10,
          "max_positions": 3, "max_correlated_risk": 0.02, "correlation": 0.80, "max_chase_atr": 0.5,
          "stale_bars": 1.5}
FAMILY_TAGS = {"trend_pullback": ["trend_following", "pullback"], "breakout": ["breakout"],
               "trend_breakout": ["trend_following", "breakout"], "mean_reversion": ["mean_reversion"]}
KILL_FILE = (Path(os.environ["LOCALAPPDATA"]) / "oliskey-alpha" / "spot-kill-switch.json") if os.environ.get("LOCALAPPDATA") \
    else ROOT / "intel" / "data" / "spot-kill-switch.json"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def view(key: str, verdict: str, says: str, **data) -> dict:
    return {"agent": key, "name": NAMES[key], "verdict": verdict, "says": says, "data": _plain(data)}


def _plain(v):
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_plain(x) for x in v]
    if isinstance(v, (np.floating, float)):
        return None if not np.isfinite(v) else round(float(v), 6)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, (pd.Timestamp, datetime)):
        return pd.Timestamp(v).isoformat()
    return v


# ---- registry and health ---------------------------------------------------------------------------------------------
def registry() -> dict:
    try:
        return json.loads((ROOT / "docs" / "intel" / "spot_registry.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"strategies": []}


def lab_verdict(reg: dict, sid: str, sym: str) -> dict:
    """Per-coin verdict wins over a basket verdict; a basket verdict covers only its own coins (as pipeline.js)."""
    rows = [s for s in reg.get("strategies", []) if s.get("strategy_id") == sid]
    own = next((s for s in rows if s.get("symbol") == sym), None)
    if own and own.get("verdict") == "APPROVED_FOR_PAPER":
        return {"verdict": "APPROVED_FOR_PAPER", "scope": sym, "expectancy_low": own.get("expectancy_low")}
    basket = next((s for s in rows if s.get("symbol") == "BASKET" and sym in (s.get("coins") or [])), None)
    if basket:
        return {"verdict": basket["verdict"], "scope": "basket of 8 unseen coins", "expectancy_low": basket.get("expectancy_low")}
    if own:
        return {"verdict": own.get("verdict"), "scope": sym, "expectancy_low": own.get("expectancy_low")}
    return {"verdict": "NOT_TESTED_ON_THIS_COIN", "scope": None, "expectancy_low": None}


def health_of(r: list[float]) -> dict:
    """Strategy Recovery rules, fixed in docs/intel/SPOT_HYPOTHESES.md (batch-4 forward protocol), run as a state machine
    over the strategy's own closed paper trades in order:
      PAUSED  after a 10R drawdown from its peak, or the last 20 trades averaging below -0.25R
      WATCH   after a 6R drawdown, or the last 20 trades averaging below 0
      back    a paused strategy returns only when its drawdown is under 5R and its last 10 trades average above 0
    It keeps its own paper record while paused, so recovery is judged on real results, not on a timer."""
    state, peak, total, reason = "ACTIVE", 0.0, 0.0, "No losing spell."
    for i, x in enumerate(r):
        total += x
        peak = max(peak, total)
        dd = peak - total
        last20 = r[max(0, i - 19): i + 1]
        last10 = r[max(0, i - 9): i + 1]
        m20 = float(np.mean(last20)) if len(last20) >= 20 else None
        m10 = float(np.mean(last10)) if len(last10) >= 10 else None
        if state == "PAUSED":
            if dd < 5 and m10 is not None and m10 > 0:
                state, reason = "WATCH", f"Recovered: drawdown {dd:.1f}R, last 10 trades {m10:+.2f}R on average."
            continue
        if dd >= 10 or (m20 is not None and m20 < -0.25):
            state, reason = "PAUSED", f"Paused: drawdown {dd:.1f}R" + (f", last 20 trades {m20:+.2f}R on average." if m20 is not None else ".")
        elif dd >= 6 or (m20 is not None and m20 < 0):
            state, reason = "WATCH", f"On watch: drawdown {dd:.1f}R" + (f", last 20 trades {m20:+.2f}R on average." if m20 is not None else ".")
        else:
            state, reason = "ACTIVE", "Record healthy."
    dd_now = peak - total
    return {"state": state, "reason": reason, "closed": len(r), "total_r": round(total, 3), "drawdown_r": round(dd_now, 3)}


def health(stored: pd.DataFrame, rules: dict) -> dict:
    out = {}
    for sid in paper.TRACKED:
        t = stored[(stored["strategy_id"] == sid) & (stored["status"] == "closed")] if not stored.empty else stored
        h = health_of([float(x) for x in t.sort_values("exit_at")["r"]] if not t.empty else [])
        if not rules.get("pause-on-drawdown") and h["state"] == "PAUSED":
            h = {**h, "state": "WATCH", "reason": h["reason"] + " (pause rule switched off in the registry)"}
        out[sid] = h
    return out


# ---- the paper account (follows TRADE decisions only) -----------------------------------------------------------------
def taken_trades(conn) -> pd.DataFrame:
    rows = conn.execute(
        """select t.id, t.strategy_id, t.symbol, t.status, t.entry_at, t.exit_at, t.entry, t.exit, t.stop0, t.stop_now,
                  t.last_price, t.r, d.risk_pct, d.decided_at
           from intel.spot_agent_decisions d join intel.spot_paper_trades t on t.id = d.order_id
           where d.decision = 'TRADE'""").fetchall()
    cols = ["id", "strategy_id", "symbol", "status", "entry_at", "exit_at", "entry", "exit", "stop0", "stop_now", "last_price",
            "r", "risk_pct", "decided_at"]
    return pd.DataFrame(rows, columns=cols)


def account_state(t: pd.DataFrame, now: datetime | None = None) -> dict:
    """Equity walk over the agents' trades: risk amount = equity at entry x the allocation's risk %."""
    now = now or _now()
    equity, peak, open_, realised, day_pnl = paper.START_EQUITY, paper.START_EQUITY, [], 0.0, 0.0
    day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
    events = []
    for _, x in t.iterrows():
        events.append((pd.Timestamp(x["entry_at"]), 0, x))
        if x["status"] == "closed" and pd.notna(x["exit_at"]):
            events.append((pd.Timestamp(x["exit_at"]), 1, x))
    amounts = {}
    for at, kind, x in sorted(events, key=lambda e: (e[0], -e[1])):
        if kind == 0:
            amounts[x["id"]] = equity * float(x["risk_pct"])
        else:
            pnl = amounts.get(x["id"], 0.0) * float(x["r"])
            equity += pnl
            realised += pnl
            peak = max(peak, equity)
            if at.to_pydatetime() >= day0:
                day_pnl += pnl
    unreal = 0.0
    for _, x in t[t["status"] == "open"].iterrows() if not t.empty else []:
        spec = BY_ID[x["strategy_id"]]
        risk = (float(x["entry"]) - float(x["stop0"])) / float(x["entry"])
        price = float(x["last_price"]) if pd.notna(x["last_price"]) else float(x["entry"])
        r_now = (price * (1 - spec.cost_per_side) - float(x["entry"]) * (1 + spec.cost_per_side)) / (float(x["entry"]) * risk)
        amt = amounts.get(x["id"], 0.0)
        unreal += amt * r_now
        open_.append({"id": x["id"], "strategy": x["strategy_id"], "symbol": x["symbol"], "entry": float(x["entry"]),
                      "stop": float(x["stop_now"]) if pd.notna(x["stop_now"]) else None, "price": price,
                      "r_now": round(r_now, 3), "risk_amount": round(amt, 2), "since": str(x["entry_at"])})
    return {"equity": equity, "peak": peak, "unrealised": unreal, "realised": realised, "day_pnl": day_pnl, "open": open_,
            "open_risk": sum(o["risk_amount"] for o in open_)}


def account(conn, stored: pd.DataFrame | None = None) -> dict:
    try:
        t = taken_trades(conn)
        s = account_state(t)
        vetoed = conn.execute("select coalesce(sum(jsonb_array_length(vetoed)), 0) from intel.spot_agent_decisions").fetchone()[0]
    except Exception:                       # noqa: BLE001 - tables not there yet
        return paper.portfolio(stored if stored is not None else pd.DataFrame())
    return {"start": paper.START_EQUITY, "equity": round(s["equity"] + s["unrealised"], 2), "realised": round(s["realised"], 2),
            "unrealised": round(s["unrealised"], 2), "taken": int(len(t)), "skipped": int(vetoed), "open": s["open"],
            "follows": "agents"}


# ---- live inputs -------------------------------------------------------------------------------------------------------
def quote(client, sym: str) -> dict | None:
    try:
        b = client.get("https://api.binance.com/api/v3/ticker/bookTicker", params={"symbol": sym}).raise_for_status().json()
        bid, ask = float(b["bidPrice"]), float(b["askPrice"])
        if bid <= 0 or ask <= 0:
            return None
        return {"bid": bid, "ask": ask, "mid": (bid + ask) / 2, "spread": (ask - bid) / ((ask + bid) / 2)}
    except Exception:                       # noqa: BLE001 - no live quote = fail closed later
        return None


def news_now(conn, sym: str, until: datetime, hours: int = 6) -> dict | None:
    """Headlines on this coin or the whole market, published AND first seen before the decision (no look-ahead)."""
    asset = sym[:-4] + "USD" if sym.endswith("USDT") else sym
    try:
        rows = conn.execute(
            """select sentiment, (coins ? %s) as own from intel.news
               where published_at > %s and published_at <= %s and seen_at <= %s and (coins ? %s or coins ? 'ALL')""",
            (asset, until - timedelta(hours=hours), until, until, asset)).fetchall()
        newest = conn.execute("select max(seen_at) from intel.news").fetchone()[0]
    except Exception:                       # noqa: BLE001 - news table missing
        return None
    good, bad = sum(1 for r in rows if r[0] > 0), sum(1 for r in rows if r[0] < 0)
    own = sum(1 for r in rows if r[1])
    fresh = newest is not None and (until - newest) < timedelta(hours=24)
    return {"count": len(rows), "own": own, "good": good, "bad": bad, "score": good - bad, "feeds_fresh": fresh}


def correlation(a: pd.DataFrame, b: pd.DataFrame, bars: int = 30) -> float | None:
    ra, rb = a["close"].pct_change().iloc[-bars:], b["close"].pct_change().iloc[-bars:]
    j = pd.concat([ra, rb], axis=1, join="inner").dropna()
    if len(j) < bars * 0.8:
        return None
    return float(j.iloc[:, 0].corr(j.iloc[:, 1]))


def kill_switch() -> dict:
    try:
        return json.loads(KILL_FILE.read_text(encoding="utf-8")) if KILL_FILE.exists() else {"on": False}
    except (OSError, ValueError):
        return {"on": True, "reason": "kill switch file unreadable: failing closed"}


def trip_kill_switch(reason: str) -> None:
    """Same file and format as backend/src/spot/risk.js KillSwitch: only a person, with a reason, can clear it."""
    if kill_switch().get("on"):
        return
    KILL_FILE.parent.mkdir(parents=True, exist_ok=True)
    state = {"on": True, "reason": reason, "setBy": "risk", "setAt": _now().isoformat()}
    KILL_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    with open(f"{KILL_FILE}.log", "a", encoding="utf-8") as log:
        log.write(json.dumps({"action": "trip", "reason": reason, "by": "risk", "at": state["setAt"]}) + "\n")


# ---- one coin, one closed bar --------------------------------------------------------------------------------------------
def decide_coin(sym: str, sig: pd.DataFrame, ctx: pd.DataFrame, tf: str, *, now: datetime, live: dict | None, news: dict | None,
                reg: dict, hl: dict, rules: dict, acct: dict, ctx_frames: dict[str, pd.DataFrame], expected: dict) -> dict:
    """Every agent's view and the final decision. Pure: all inputs are passed in, so tests can replay any situation."""
    views: list[dict] = []
    bar = paper.BARS[tf]
    group = paper.GROUPS[tf]
    preps = {sid: prepare(sig, ctx, BY_ID[sid]) for sid in group}
    f = preps[group[0]]
    last = f.iloc[-1]
    bar_at = f.index[-1]
    closed_at = bar_at + bar
    age_bars = (now - closed_at.to_pydatetime()) / bar

    # 1 Market Intelligence
    ms = market_state(sym, tf, f)
    ret3 = float(f["close"].iloc[-1] / f["close"].iloc[-4] - 1) if len(f) > 4 else float("nan")
    quote_volume = float(last["volume"] * last["close"])
    stale = age_bars > LIMITS["stale_bars"]
    mi_ok = not stale and ms["regime"] != "UNKNOWN"
    views.append(view("market", "PASS" if mi_ok else "BLOCK",
                      ("Data is stale: the last closed bar is too old." if stale else
                       f"{ms['regime'].replace('_', ' ').title()}: trend {ms['trendDirection'].lower()}, strength {ms['trendStrength']:.0f}, "
                       f"volatility {ms['volatilityPercentile']:.0f}th percentile, RSI {last['rsi']:.0f}."),
                      regime=ms["regime"], trend=ms["trendDirection"], strength=ms["trendStrength"],
                      volatility_pct=ms["volatilityPercentile"], uncertainty=ms["uncertainty"], rsi=float(last["rsi"]),
                      momentum_3bars=ret3, volume_vs_median=float(last["vol_ratio"]) if pd.notna(last["vol_ratio"]) else None,
                      quote_volume=quote_volume, avoid=ms["avoid"], evidence=ms["evidence"]))

    # 2 News & Event Risk
    veto_news = rules.get("news-veto", False)
    if news is None or not news["feeds_fresh"]:
        views.append(view("news", "INFO", "No fresh news feed: decision rests on the chart alone.", available=False))
        news_clash = False
    else:
        news_clash = news["bad"] >= 2 and news["score"] <= -2
        busy = news["own"] >= 6
        says = (f"{news['count']} headlines in 6 h ({news['good']} good, {news['bad']} bad)"
                + (": clearly negative - a long now would fight the news." if news_clash else ": no clash with a long.")
                + (" Busy news on this coin: event risk." if busy else ""))
        views.append(view("news", ("WAIT" if veto_news else "INFO") if news_clash else "PASS", says,
                          **news, clash=news_clash, event_risk=busy, rule_on=veto_news))

    # 3 Strategy Discovery / 4 Strategy Testing (per coin, from the registry and the live record)
    tested = {sid: lab_verdict(reg, sid, sym) for sid in group}
    views.append(view("discovery", "INFO", f"{len(paper.TRACKED)} written strategies are tracked; {len(group)} trade on {tf} bars.",
                      strategies=list(group)))
    approved = [sid for sid, v in tested.items() if v["verdict"] == "APPROVED_FOR_PAPER"]
    views.append(view("testing", "INFO",
                      (f"Approved for paper on this coin: {', '.join(nice(a) for a in approved)}." if approved else "No strategy is approved for paper on this coin yet.")
                      + " The others keep a separate paper record as evidence.",
                      lab={sid: v["verdict"] for sid, v in tested.items()},
                      forward={sid: hl[sid]["closed"] for sid in group}))

    # 5 Strategy Selection
    signals = [sid for sid in group if bool(entries(preps[sid], BY_ID[sid]).iloc[-1])]
    candidates, notes = [], []
    for sid in signals:
        tags = FAMILY_TAGS.get(BY_ID[sid].family, [])
        misfit = "all" in ms["avoid"] or any(t in ms["avoid"] for t in tags)
        if tested[sid]["verdict"] != "APPROVED_FOR_PAPER":
            notes.append(f"{nice(sid)} has a signal but is not approved on {coin(sym)} ({tested[sid]['verdict'].replace('_', ' ').lower()}), so it only counts as evidence")
        elif hl[sid]["state"] == "PAUSED":
            notes.append(f"{nice(sid)} has a signal but is paused by Strategy Recovery")
        elif misfit and rules.get("regime-fit"):
            notes.append(f"{nice(sid)} has a signal but this market ({ms['regime'].replace('_', ' ').lower()}) is on its avoid list")
        else:
            candidates.append(sid)
            if misfit:
                notes.append(f"{nice(sid)}: this market is on its avoid list, but that filter is not in use (its test failed or is pending)")
    pick = max(candidates, key=lambda s: tested[s]["expectancy_low"] or -9) if candidates else None
    if not signals:
        sel_says = "No strategy has a signal on this bar."
    elif pick:
        sel_says = f"Chose {nice(pick)} (best proven record of {len(candidates)} eligible)."
    else:
        sel_says = "Signals exist, but none may trade: " + "; ".join(notes) + "."
    views.append(view("selection", "PASS" if pick else ("INFO" if not signals else "BLOCK"), sel_says,
                      signals=signals, eligible=candidates, chosen=pick, notes=notes))

    # 6 Allocation
    risk_pct = 0.0
    if pick:
        risk_pct = LIMITS["risk_per_trade"] * (0.5 if hl[pick]["state"] == "WATCH" and rules.get("watch-half-risk") else 1.0)
        views.append(view("allocation", "PASS", f"{nice(pick)} may risk {risk_pct * 100:.1f}% of the account ({hl[pick]['state'].lower()}).",
                          risk_pct=risk_pct, health=hl[pick]["state"]))
    else:
        views.append(view("allocation", "INFO", "Nothing to allocate.", risk_pct=0.0))

    # 7 Entry Timing, 8 Duration, 9 Exit
    entry_ok, plan = False, None
    if pick:
        spec = BY_ID[pick]
        p = preps[pick]
        atr = float(p["atr"].iloc[-1])
        planned = float(p["close"].iloc[-1])
        problems = []
        if age_bars > 1.0:
            problems.append(f"signal is {age_bars:.1f} bars old")
        if live is None:
            problems.append("no live price (fail closed)")
        else:
            chase = (live["mid"] - planned) / atr if atr > 0 else 9
            if chase > LIMITS["max_chase_atr"]:
                problems.append(f"price ran {chase:.2f} ATR above the planned entry")
            if live["spread"] > spec.max_spread_pct:
                problems.append(f"spread {live['spread'] * 100:.3f}% is wider than {spec.max_spread_pct * 100:.3f}%")
        ref = live["mid"] if live else planned
        stop = stop_price(p.iloc[-1], ref, spec)
        risk = ref - stop
        if not (np.isfinite(stop) and risk > 0):
            problems.append("no valid stop below the entry")
        target = (ref + spec.target_r * risk) if spec.target_mode == "r" else (float(p["bb_mid"].iloc[-1]) if spec.target_mode == "bb_mid" else None)
        if spec.target_mode == "bb_mid" and target is not None and not target > ref * (1 + 2 * spec.cost_per_side):
            problems.append("too little room to the target after costs")
        entry_ok = not problems
        views.append(view("entry", "PASS" if entry_ok else "BLOCK",
                          "Closed candle, fresh signal, price close to plan, spread fine." if entry_ok else "Entry refused: " + "; ".join(problems) + ".",
                          planned=planned, live=live and live["mid"], spread=live and live["spread"], age_bars=age_bars, problems=problems))
        exp = expected.get(pick)
        hours = bar.total_seconds() / 3600
        views.append(view("duration", "INFO",
                          f"{spec.style.title()} trade: similar trades lasted about {exp:.0f} bars (~{exp * hours:.0f} h)" if exp else f"{spec.style.title()} trade",
                          style=spec.style, expected_bars=exp, time_exit_bars=None if spec.time_stop_bars > 10**6 else spec.time_stop_bars,
                          time_exit_min_r=spec.time_stop_min_r))
        plan = {"entry": ref, "stop": stop, "target": target, "trail": spec.trail,
                "breakeven_at_1r": spec.target_mode == "r" and spec.target_r > 1.0}
        views.append(view("exit", "PASS" if np.isfinite(stop) and risk > 0 else "BLOCK",
                          f"Stop {stop:.6g} ({risk / ref * 100:.2f}% below)" + (f", target {target:.6g}" if target else ", no fixed target: stop trails up to the 20-bar low")
                          + (", stop to break-even after +1R." if plan["breakeven_at_1r"] else "."), **plan))
    else:
        views.append(view("entry", "INFO", "No entry to time."))
        views.append(view("duration", "INFO", "No new trade."))
        views.append(view("exit", "INFO", "No new trade."))

    # open positions on this coin: duration and thesis check (watch only; exits follow the tested rules)
    mine = [o for o in acct["open"] if o["symbol"] == sym]
    if mine:
        weak = ms["regime"] == "TRENDING_DOWN" or last["close"] < last["ema50"]
        views[-2]["says"] += f" Open {nice(mine[0]['strategy'])} trade: thesis {'weakening (regime/EMA50)' if weak else 'intact'}."
        views[-2]["data"]["open_thesis_weak"] = bool(weak)

    # 10 Risk Manager (deterministic, always runs)
    eq = acct["equity"] + acct["unrealised"]
    ks = kill_switch()
    checks = []
    def chk(ok: bool, text: str):
        checks.append({"ok": bool(ok), "check": text})
    chk(not ks.get("on"), "kill switch off" if not ks.get("on") else f"kill switch ON: {ks.get('reason')}")
    dd = (acct["peak"] - eq) / acct["peak"] if acct["peak"] > 0 else 1
    chk(dd < LIMITS["max_drawdown"], f"drawdown {dd * 100:.1f}% (limit {LIMITS['max_drawdown'] * 100:.0f}%)")
    day = acct["day_pnl"] / eq if eq > 0 else -1
    chk(day > -LIMITS["max_daily_loss"], f"today {day * 100:+.2f}% (limit -{LIMITS['max_daily_loss'] * 100:.0f}%)")
    chk(len(acct["open"]) < LIMITS["max_positions"], f"{len(acct['open'])} of {LIMITS['max_positions']} positions open")
    chk(not mine, "no position on this coin" if not mine else "already holding this coin")
    room = LIMITS["max_open_risk"] * eq - acct["open_risk"]
    chk(not pick or room >= risk_pct * eq - 1e-6, f"open risk {acct['open_risk'] / eq * 100 if eq else 0:.1f}% of {LIMITS['max_open_risk'] * 100:.0f}%")
    if rules.get("corr-limit"):
        corr_risk = 0.0
        for o in acct["open"]:
            other = ctx_frames.get(o["symbol"])
            c = correlation(ctx, other) if other is not None else None
            if c is None or c >= LIMITS["correlation"]:          # unknown correlation counts as correlated (fail closed)
                corr_risk += o["risk_amount"]
        chk(not pick or (corr_risk + risk_pct * eq) <= LIMITS["max_correlated_risk"] * eq + 1e-6,
            f"correlated open risk {corr_risk / eq * 100 if eq else 0:.1f}% (limit {LIMITS['max_correlated_risk'] * 100:.0f}%)")
    chk(mi_ok, "market data fresh and readable")
    if dd >= LIMITS["max_drawdown"]:
        trip_kill_switch(f"paper drawdown {dd * 100:.1f}% reached the {LIMITS['max_drawdown'] * 100:.0f}% limit")
    if day <= -LIMITS["max_daily_loss"]:
        trip_kill_switch(f"paper daily loss {day * 100:.2f}% reached the {LIMITS['max_daily_loss'] * 100:.0f}% limit")
    risk_ok = all(c["ok"] for c in checks)
    failed = [c["check"] for c in checks if not c["ok"]]
    views.append(view("risk", "PASS" if risk_ok else "BLOCK", "All limits clear." if risk_ok else "Refused: " + "; ".join(failed) + ".",
                      checks=checks, equity=eq, size_usdt=(risk_pct * eq / ((plan["entry"] - plan["stop"]) / plan["entry"]))
                      if plan and plan["entry"] > plan["stop"] else None))

    # 13 Collaboration: the final decision
    blockers = [v["name"] for v in views if v["verdict"] in ("BLOCK", "WAIT")]
    waiting = any(v["verdict"] == "WAIT" for v in views)
    trade = bool(pick) and entry_ok and risk_ok and not waiting and mi_ok
    order_id = f"{pick}|{BY_ID[pick].version}|{sym}|{bar_at.isoformat()}" if pick else None
    decision = "TRADE" if trade else ("WAIT" if pick and waiting else "NO_TRADE")

    # 11 Execution
    if trade:
        size = views[-1]["data"].get("size_usdt")
        views.append(view("execution", "PASS", f"Paper buy at the next bar's open, about {size:,.0f} USDT, with the stop attached. Order id is fixed, so it can never be sent twice.",
                          order_id=order_id, cost_per_side=BY_ID[pick].cost_per_side, real_money=False))
    else:
        views.append(view("execution", "INFO", "No order.", real_money=False))
    # Performance Learning / Recovery views are filled from the records
    views.append(view("learning", "INFO", f"{nice(pick)}: {hl[pick]['closed']} closed paper trades so far, {hl[pick]['total_r']:+.2f}R." if pick
                      else "Every signal here, taken or not, is scored when its trade ends.", ))
    views.append(view("recovery", "INFO", f"{nice(pick)}: {hl[pick]['reason']}" if pick else
                      "; ".join(f"{nice(s)} {hl[s]['state'].lower()}" for s in group) + "."))
    if trade:
        final = f"TRADE: {nice(pick)} on {coin(sym)}. Every agent needed agreed and none blocked."
    elif decision == "WAIT":
        final = f"WAIT: {nice(pick)} had a good signal on {coin(sym)}, but " + " and ".join(blockers) + " asked to wait."
    elif blockers:
        final = "NO TRADE: blocked by " + ", ".join(blockers) + "."
    else:
        final = "NO TRADE: " + sel_says
    views.append(view("collaboration", "PASS" if trade else "INFO", final, decision=decision, blockers=blockers))

    vetoed = [f"{s}|{BY_ID[s].version}|{sym}|{bar_at.isoformat()}" for s in signals
              if tested[s]["verdict"] == "APPROVED_FOR_PAPER" and not (trade and s == pick)]
    by = [v["agent"] for v in views if v["verdict"] in ("BLOCK", "WAIT")]
    return {"id": f"{tf}|{sym}|{bar_at.isoformat()}", "symbol": sym, "timeframe": tf, "bar_at": bar_at.to_pydatetime(),
            "decision": decision, "strategy_id": pick, "order_id": order_id if trade else None,
            "risk_pct": risk_pct if trade else None, "vetoed": [{"id": v, "by": by} for v in vetoed], "agents": views,
            "has_signal": bool(signals)}


# ---- one run over all coins --------------------------------------------------------------------------------------------
def expected_bars(frames: dict, group: tuple) -> dict:
    """Typical holding time per strategy from its full stored history on these coins (median bars)."""
    out = {}
    for sid in group:
        bars = []
        for sym, (sig, ctx) in list(frames.items())[:6]:
            try:
                t = bt.run(prepare(sig, ctx, BY_ID[sid]), BY_ID[sid])
                bars += list(t["bars"]) if not t.empty else []
            except Exception:              # noqa: BLE001
                continue
        out[sid] = float(np.median(bars)) if bars else None
    return out


def decide(conn, client, frames: dict, tf: str, now: datetime | None = None) -> list[dict]:
    now = now or _now()
    imp.ensure(conn)
    rules = imp.active_rules(conn)
    reg = registry()
    stored = pd.DataFrame(conn.execute("select strategy_id, status, exit_at, r from intel.spot_paper_trades").fetchall(),
                          columns=["strategy_id", "status", "exit_at", "r"])
    hl = health(stored, rules)
    ctx_frames = {s: c for s, (_, c) in frames.items()}
    expected = expected_bars(frames, paper.GROUPS[tf])
    out = []
    for sym in sorted(frames):
        sig, ctx = frames[sym]
        acct = account_state(taken_trades(conn), now)
        d = decide_coin(sym, sig, ctx, tf, now=now, live=quote(client, sym), news=news_now(conn, sym, now), reg=reg, hl=hl,
                        rules=rules, acct=acct, ctx_frames=ctx_frames, expected=expected)
        store(conn, d)
        out.append(d)
    return out


def store(conn, d: dict) -> None:
    """Frozen once written. The 15m group keeps a full record only for bars with a signal; otherwise one rolling row per coin."""
    keep = d["timeframe"] == "4h" or d["has_signal"]
    did = d["id"] if keep else f"latest|{d['timeframe']}|{d['symbol']}"
    sql = """insert into intel.spot_agent_decisions (id, symbol, timeframe, bar_at, decision, strategy_id, order_id, risk_pct, vetoed, agents)
             values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"""
    sql += " on conflict (id) do nothing" if keep else """ on conflict (id) do update set bar_at = excluded.bar_at, decided_at = now(),
             decision = excluded.decision, agents = excluded.agents"""
    conn.execute(sql, (did, d["symbol"], d["timeframe"], d["bar_at"], d["decision"], d["strategy_id"], d["order_id"], d["risk_pct"],
                       Jsonb(d["vetoed"]), Jsonb(d["agents"])))


def prune(conn, days: int = 30) -> None:
    """Quiet 4h bars (no signal, no trade) are kept 30 days; decisions with a signal or a trade are kept for good."""
    conn.execute("""delete from intel.spot_agent_decisions where timeframe = '4h' and decision = 'NO_TRADE'
                    and jsonb_array_length(vetoed) = 0 and strategy_id is null and bar_at < now() - make_interval(days => %s)
                    and not exists (select 1 from jsonb_array_elements(agents) a
                                    where a->>'agent' = 'selection' and jsonb_array_length(a->'data'->'signals') > 0)""", (days,))


# ---- what the app shows --------------------------------------------------------------------------------------------------
def veto_scores(conn) -> dict:
    """Performance Learning: what the blocked signals really did. Positive average R = the vetoes cost money."""
    rows = conn.execute("""select v->'by' as by, t.r from intel.spot_agent_decisions d, jsonb_array_elements(d.vetoed) v
                           join intel.spot_paper_trades t on t.id = v->>'id' where t.status = 'closed'""").fetchall()
    out: dict[str, list[float]] = {}
    for by, r in rows:
        for a in by or []:
            out.setdefault(a, []).append(float(r))
    return {a: {"n": len(v), "avg_r": round(float(np.mean(v)), 3), "total_r": round(float(np.sum(v)), 3)} for a, v in out.items()}


def overview(conn, stored: pd.DataFrame) -> dict:
    try:
        imp.ensure(conn)
        rules = imp.active_rules(conn)
        latest = conn.execute(
            """select distinct on (timeframe, symbol) id, symbol, timeframe, bar_at, decided_at, decision, strategy_id, agents
               from intel.spot_agent_decisions order by timeframe, symbol, bar_at desc, decided_at desc""").fetchall()
        recent = conn.execute(
            """select id, symbol, timeframe, bar_at, decided_at, decision, strategy_id, agents from intel.spot_agent_decisions
               where decision <> 'NO_TRADE' or exists (select 1 from jsonb_array_elements(agents) a
                 where a->>'agent' = 'selection' and jsonb_array_length(a->'data'->'signals') > 0)
               order by decided_at desc limit 20""").fetchall()
        counts = dict(conn.execute("select decision, count(*) from intel.spot_agent_decisions group by decision").fetchall())
        vetoes = veto_scores(conn)
        improvements = imp.listing(conn)
    except Exception as err:               # noqa: BLE001 - before the first run
        return {"agents_error": f"{type(err).__name__}"}
    st = stored.rename(columns={}) if not stored.empty else pd.DataFrame(columns=["strategy_id", "status", "exit_at", "r"])
    hl = health(st, rules)
    pack = lambda r: {"id": r[0], "symbol": r[1], "timeframe": r[2], "bar_at": str(r[3]), "decided_at": str(r[4]), "decision": r[5],
                      "strategy": r[6], "agents": r[7]}
    latest = [pack(r) for r in latest]
    cards = []
    for key, name, role, why in AGENTS:
        seen = [a for d in latest for a in d["agents"] if a["agent"] == key]
        tally = {v: sum(1 for a in seen if a["verdict"] == v) for v in ("PASS", "WAIT", "BLOCK", "INFO")}
        sample = next((a["says"] for d in latest if d["timeframe"] == "4h" for a in d["agents"] if a["agent"] == key), None)
        cards.append({"key": key, "name": name, "role": role, "why": why, "views": len(seen), "tally": tally,
                      "last": sample, "kind": "deterministic rules", "vetoes": vetoes.get(key)})
    return {"agents": {"cards": cards, "latest": latest, "recent": [pack(r) for r in recent], "counts": counts,
                       "rules": rules, "health": hl, "vetoes": vetoes, "improvements": improvements,
                       "limits": LIMITS}}
