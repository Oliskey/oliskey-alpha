"""Scanner: for each covered market (and each test variant, e.g. crypto on 1 h and 4 h bars), look at the last closed
bar and decide one status:
  trade  - an accepted rule fired, or the accepted LightGBM layer approves the setup, AND the market group is allowed to
           publish by the harder test (docs/intel/stress.json) and its safety stop has not tripped
  avoid  - a setup fired but is not allowed to publish, or volatility is chaotic: don't enter
  wait   - no setup right now, or the data is out of date
Ideas and avoided setups are stored before their outcome and resolved later (tracking.py)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from psycopg.types.json import Jsonb

from . import db, ml, tracking
from .indicators import add_all
from .settings import APP_ASSETS, ASSETS, asset_cfg, variants
from .strategies import REWARDS, STOP_ATR, STRATEGIES, TARGET_ATR, plain_reasons, signals, split_variant, variant_name

TF = {"1h": timedelta(hours=1), "4h": timedelta(hours=4), "1d": timedelta(days=1)}
TF_LABEL = {"1h": "1-hour", "4h": "4-hour", "1d": "Daily"}
NAMES = {"trend_pullback": "Trend pullback", "breakout": "Breakout", "mean_reversion": "Mean reversion"}
RANK = {"trade": 0, "avoid": 1, "wait": 2}
forex_readings: list[tuple] = []   # this scan's crypto setups, so the app can show what it read
STALE_AFTER = {"1h": timedelta(hours=3), "4h": timedelta(hours=9), "1d": timedelta(days=5)}   # a long weekend still passes


def load_stats() -> dict[tuple[str, str], dict]:
    with db.connect() as c:
        rows = c.execute("select strategy, asset_class, trades, wins, hit_rate, breakeven, accepted from intel.strategy_stats").fetchall()
    return {(r[0], r[1]): {"trades": r[2], "wins": r[3], "hit_rate": r[4], "breakeven": r[5], "accepted": r[6]} for r in rows}


def scan_variant(asset_id: str, cls: str, stats: dict, evidence: dict) -> dict:
    cfg = asset_cfg(asset_id, cls)
    tf, step = cfg["timeframe"], TF[cfg["timeframe"]]
    bars = db.load_bars(asset_id, tf)
    if len(bars) < 250:
        return {"asset": asset_id, "class": ASSETS[asset_id]["class"], "status": "wait", "reason": "Not enough history yet."}
    df = add_all(bars)
    sig = signals(df)
    row, reg = df.iloc[-1], sig["regime"].iat[-1]
    bar_close = df.index[-1] + step
    if datetime.now(timezone.utc) - bar_close > STALE_AFTER[tf]:
        return {"asset": asset_id, "class": ASSETS[asset_id]["class"], "status": "wait", "reason": f"{TF_LABEL[tf]}: market data is out of date, so no signal is shown."}
    base = {"asset": asset_id, "class": ASSETS[asset_id]["class"], "variant": cls, "regime": reg, "timeframe": tf,
            "last_close": float(row["close"]), "bar_close": bar_close.isoformat()}

    fired = [(s, int(sig[s].iat[-1])) for s in STRATEGIES if sig[s].iat[-1] != 0]
    if not fired:
        if reg == "chaos":
            return {**base, "status": "avoid", "reason": f"{TF_LABEL[tf]}: volatility is in its top 10%, swings are too wild to plan a stop. Don't enter."}
        return {**base, "status": "wait", "reason": f"{TF_LABEL[tf]}: no setup right now. Wait for one."}

    group = evidence.get(cls)
    may_publish = bool(group) and group["status"] != "blocked" and not group["paused"]
    ml_stats = stats.get(("ml", cls), {"accepted": False})
    feats_base = ml.feature_frame(df).iloc[-1]
    best = None
    for strat, direction in ((variant_name(s, r), d) for s, d in fired for r in REWARDS):
        st = stats.get((strat, cls), {"trades": 0, "wins": 0, "hit_rate": 0.5, "breakeven": 0.5, "accepted": False})
        rule_p = ml.rule_probability(st["wins"], st["trades"])
        ml_p = ml.predict_live(cls, ml.trade_features(feats_base, [direction], [strat], [reg], [cls]), rule_p)
        breakeven = st["breakeven"]
        rule_ok = bool(st["accepted"])
        # a test group publishes on the model's reading alone: the app says plainly that this is unproven
        ml_ok = (bool(ml_stats["accepted"]) or (bool(group) and group["status"] == "test")) and ml_p is not None and ml_p > breakeven + ml.MARGIN
        cand = {"strat": strat, "direction": direction, "st": st, "rule_p": rule_p, "ml_p": ml_p,
                "approved": (rule_ok or ml_ok) and reg != "chaos" and may_publish, "by": "rules" if rule_ok else "ml" if ml_ok else None}
        if best is None or (cand["approved"], cand["ml_p"] or 0) > (best["approved"], best["ml_p"] or 0):
            best = cand
        if ml_p is not None and cls.startswith("crypto"):
            forex_readings.append((asset_id, ml_p - breakeven, ml_p, breakeven))

    strat, direction, st = best["strat"], best["direction"], best["st"]
    base_strat, reward = split_variant(strat)
    p = best["ml_p"] if best["by"] == "ml" else best["rule_p"]
    entry = float(row["close"])
    risk = STOP_ATR * float(row["atr"])
    cost_r = (cfg["cost_pct"] / 100) * entry / risk
    ev = 100 * (p * (reward - cost_r) - (1 - p) * (1 + cost_r))
    reasons = plain_reasons(base_strat, direction, row, reg, TF_LABEL[tf], reward)
    idea = {
        "asset_id": asset_id, "asset_class": cls, "strategy": strat, "regime": reg, "direction": direction,
        "tf": tf, "bar_time": bar_close.to_pydatetime(), "enter_until": (bar_close + step).to_pydatetime(),
        "expires_at": (bar_close + step * (cfg["horizon_bars"] + 1)).to_pydatetime(),
        "entry": entry, "stop": entry - direction * risk, "target": entry + direction * risk * reward,
        "probability": p, "ev_per_100": ev, "reasons": reasons,
        "kind": "idea" if best["approved"] else "avoid",
        "horizon_hours": int(cfg["horizon_bars"] * step / timedelta(hours=1)),
    }
    save_idea(idea)
    side = "Up" if direction > 0 else "Down"
    if idea["kind"] == "idea":
        label = {"experimental": "Experimental signal", "test": "Test signal"}.get(group["status"], "Signal")
        return {**base, "status": "trade", "strategy": strat, "direction": direction,
                "reason": f"{TF_LABEL[tf]}: {label}, {NAMES[base_strat]} {side}, with a target {reward:g}x the stop. It can lose."}
    if reg == "chaos":
        why = f"{TF_LABEL[tf]}: setup found, but volatility is chaotic. Don't enter."
    elif group and group["paused"]:
        why = f"{TF_LABEL[tf]}: signals for this group are paused. {group['paused']} Don't enter."
    else:
        why = f"{TF_LABEL[tf]}: {NAMES[base_strat]} {side} setup found, but this group has not earned a signal in testing. Don't enter."
    return {**base, "status": "avoid", "strategy": strat, "direction": direction, "reason": why}


def save_idea(i: dict) -> None:
    with db.connect() as c:
        c.execute(
            """insert into intel.ideas (asset_id, asset_class, strategy, regime, direction, tf, bar_time, enter_until,
                 expires_at, entry, stop, target, probability, ev_per_100, reasons, kind, horizon_hours)
               values (%(asset_id)s, %(asset_class)s, %(strategy)s, %(regime)s, %(direction)s, %(tf)s, %(bar_time)s,
                 %(enter_until)s, %(expires_at)s, %(entry)s, %(stop)s, %(target)s, %(probability)s, %(ev_per_100)s,
                 %(reasons)s, %(kind)s, %(horizon_hours)s)
               on conflict (asset_id, strategy, tf, bar_time) do nothing""",
            {**i, "reasons": Jsonb(i["reasons"])},
        )


def scan_all() -> list[dict]:
    """One status per market: the strongest across its variants (trade > don't enter > wait)."""
    stats = load_stats()
    evidence = tracking.evidence()["groups"]
    forex_readings.clear()
    out = []
    for asset_id in APP_ASSETS:
        results = []
        for cls in variants(asset_id):
            try:
                results.append(scan_variant(asset_id, cls, stats, evidence))
            except Exception as err:
                results.append({"asset": asset_id, "class": ASSETS[asset_id]["class"], "status": "wait", "reason": f"Scan failed: {err}"})
        best = min(results, key=lambda r: RANK[r["status"]])
        if len(results) > 1:
            best = {**best, "reason": " ".join(r["reason"] for r in sorted(results, key=lambda r: RANK[r["status"]]))}
        out.append(best)
    return out
