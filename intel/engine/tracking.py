"""Resolves stored ideas and avoided setups against the bars that came after them, using the same rules as the
backtest (stop first on a same-bar touch, time exit at the horizon). Runs every scan cycle."""
from __future__ import annotations

import json
from datetime import timedelta

from . import db
from .backtest import PRIOR, wilson_low
from .settings import ROOT, asset_cfg

TF = {"1h": timedelta(hours=1), "4h": timedelta(hours=4), "1d": timedelta(days=1)}
EVIDENCE_FILE = ROOT / "docs" / "intel" / "stress.json"
SAFETY_MIN_FINISHED = 20      # fixed in advance: enough finished live signals to compare with testing
SAFETY_LOSSES_IN_A_ROW = 8    # fixed in advance: at the tested win rate this is very unlikely by chance
TOO_FEW_LIVE = 30             # below this, the app says there are too few live results to judge


def resolve_open() -> int:
    with db.connect() as c:
        open_rows = c.execute(
            """select id, asset_id, asset_class, tf, bar_time, direction, entry, stop, target, expires_at
               from intel.ideas where status = 'open' and asset_class not in ('crypto_ft', 'crypto_iz', 'crypto_ft_wide', 'crypto_iz_wide')""").fetchall()
    done = 0
    for (iid, asset_id, asset_class, tf, bar_time, direction, entry, stop, target, expires_at) in open_rows:
        cfg = asset_cfg(asset_id, asset_class)
        bars = db.load_bars(asset_id, tf)
        # Bars whose open is at/after the signal bar's close are the ones the trade lives through.
        after = bars[bars.index >= bar_time][: cfg["horizon_bars"]]
        if after.empty:
            continue
        risk = abs(entry - stop)
        outcome = None
        for ts, b in after.iterrows():
            hit_stop = b.low <= stop if direction > 0 else b.high >= stop
            hit_target = b.high >= target if direction > 0 else b.low <= target
            if hit_stop:
                outcome = ("lost", -1.0, stop, ts)
                break
            if hit_target:
                outcome = ("won", abs(target - entry) / risk, target, ts)
                break
        if outcome is None and len(after) >= cfg["horizon_bars"]:
            last = after.iloc[-1]
            r = direction * (last.close - entry) / risk
            outcome = ("expired", r, last.close, after.index[-1])
        if outcome is None:
            continue
        status, r, exit_price, ts = outcome
        with db.connect() as c:
            c.execute(
                """update intel.ideas set status = %s, result_r = %s, exit_price = %s, resolved_at = %s
                   where id = %s and status = 'open'""",
                (status, float(r), float(exit_price), ts + TF[tf], iid))
        done += 1
    return done


def safety_stop(results: list[float], breakeven: float) -> str | None:
    """Why this group must stop publishing, or None. `results` are finished live results in R, oldest first."""
    n, wins = len(results), sum(1 for r in results if r > 0)
    if n >= SAFETY_MIN_FINISHED and wilson_low(wins, n, -1.96) < breakeven:
        return f"Live results fell below what testing showed: {wins} of {n} won, and it needs {breakeven:.0%} to break even."
    tail = results[-SAFETY_LOSSES_IN_A_ROW:]
    if len(tail) == SAFETY_LOSSES_IN_A_ROW and all(r <= 0 for r in tail):
        return f"The last {SAFETY_LOSSES_IN_A_ROW} live signals all lost."
    return None


def evidence() -> dict:
    """The real test numbers and live record for each market group. Without a test file nothing may publish."""
    try:
        saved = json.loads(EVIDENCE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        saved = {"generated_at": None, "groups": {}}
    with db.connect() as c:
        rows = c.execute(
            """select asset_class, status, result_r from intel.ideas where kind = 'idea' order by resolved_at nulls last, id""").fetchall()
    groups = {}
    for cls, g in saved["groups"].items():
        mine = [r for r in rows if r[0] == cls]
        results = [r[2] or 0.0 for r in mine if r[1] != "open"]
        reason = safety_stop(results, g["breakeven"]) if g["status"] != "blocked" else None
        groups[cls] = {
            "label": g["label"], "status": g["status"], "paused": reason,
            "test": {k: g[k] for k in ("trades", "wins", "low", "high", "breakeven", "avg_r", "corrected_low", "failed")},
            "live": {"won": sum(1 for r in results if r > 0), "lost": sum(1 for r in results if r <= 0),
                     "open": sum(1 for r in mine if r[1] == "open"), "finished": len(results), "too_few": len(results) < TOO_FEW_LIVE},
        }
    from . import updown   # here, because it needs the research module, which needs this package
    for cls, ft in ((updown.CLASS, updown.evidence_group()), (updown.IZ_CLASS, updown.iz_evidence_group()),
                    (updown.CLASS_WIDE, updown.wide_evidence_group("fixed_time")), (updown.IZ_WIDE, updown.wide_evidence_group("inzone"))):
        if not ft:
            continue
        mine = [r for r in rows if r[0] == cls]
        results = [r[2] or 0.0 for r in mine if r[1] != "open"]
        groups[cls] = {
            "label": ft["label"], "status": ft["status"], "paused": safety_stop(results, ft["breakeven"]),
            "test": {k: ft[k] for k in ("trades", "wins", "low", "high", "breakeven", "avg_r", "corrected_low", "failed")},
            "live": {"won": sum(1 for r in results if r > 0), "lost": sum(1 for r in results if r <= 0),
                     "open": sum(1 for r in mine if r[1] == "open"), "finished": len(results), "too_few": len(results) < TOO_FEW_LIVE},
        }
    return {"tested_at": saved["generated_at"], "groups": groups}


def performance() -> dict:
    """Live track record: how published ideas did, and how the setups it said to skip would have done."""
    with db.connect() as c:
        rows = c.execute(
            """select kind, strategy, asset_class, status, result_r from intel.ideas where status <> 'open'""").fetchall()
        stats = c.execute(
            """select strategy, asset_class, trades, wins, hit_rate, hit_low, breakeven, expectancy_r, accepted
               from intel.strategy_stats order by asset_class, strategy""").fetchall()

    def block(kind: str) -> dict:
        rs = [r for r in rows if r[0] == kind]
        wins = sum(1 for r in rs if (r[4] or 0) > 0)
        return {
            "resolved": len(rs), "wins": wins, "hit_rate": wins / len(rs) if rs else None,
            "avg_r": sum(r[4] or 0 for r in rs) / len(rs) if rs else None,
            "won": sum(1 for r in rs if r[3] == "won"), "lost": sum(1 for r in rs if r[3] == "lost"),
            "expired": sum(1 for r in rs if r[3] == "expired"),
        }

    return {
        "ideas": block("idea"),
        "avoided": block("avoid"),
        "backtest": [
            {"strategy": s[0], "asset_class": s[1], "trades": s[2], "wins": s[3], "hit_rate": s[4], "hit_low": s[5],
             "breakeven": s[6], "expectancy_r": s[7], "accepted": s[8],
             "probability": (s[3] + PRIOR) / (s[2] + 2 * PRIOR)} for s in stats],
    }
