"""The agents' shared improvement registry (intel.spot_improvements).

Each entry is a change one agent proposes, with why it should help, which agents and strategies it touches, its evidence,
every affected agent's review (accept / reject / defer, with numbers), and a dated history of every status change.

Lifecycle: proposed -> backtested -> walk_forward_tested -> paper_validating -> approved -> deployed
           (or rejected / deferred / rolled_back at any step)
  * A rule acts on the paper account only while its status is "deployed" (active_rules). Nothing else can switch it on.
  * Status moves only through the fixed tests below, never because an agent says it is profitable.
  * Reviews that disagree (one strategy improves, another gets worse) are flagged as a conflict and the change is not
    promoted. A rule shown to hurt on its own forward record is rolled back automatically and the history says why.
  * A change to how a frozen strategy trades (entries, exits) can never be deployed into that strategy's record: once it passes
    its tests it is approved only as a NEW version that must earn its own forward record.
  * Real money is never reachable from here (REAL-MONEY GATE).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
from psycopg.types.json import Jsonb

MIN_FORWARD = 30          # vetoed / affected forward trades needed before a forward verdict
ROLLBACK_AVG_R = 0.10     # blocked trades averaging above this = the rule is costing money
CROSS_TEST_EVERY = timedelta(days=7)

SEED = [
    {"id": "news-veto", "title": "Wait when the news clearly disagrees with a long", "origin_agent": "news",
     "affects": ["selection", "execution", "collaboration"], "status": "deployed",
     "why": "A chart breakout during clearly bad news often fails. Waiting costs little; a failed breakout costs a full stop. "
            "It cannot be backtested (there is no news history before November 2026), so it runs from the start as the owner's "
            "rule and is judged on its own forward record: if the trades it blocks turn out to win, it is rolled back."},
    {"id": "corr-limit", "title": "Limit correlated positions to 2% open risk", "origin_agent": "risk",
     "affects": ["allocation", "risk", "execution"], "status": "deployed",
     "why": "Crypto coins often fall together. Three 'different' trades that move as one are one big bet. Capping correlated "
            "risk keeps one market drop from hitting several positions at once."},
    {"id": "pause-on-drawdown", "title": "Pause a strategy after a 10R losing spell, bring it back when it recovers",
     "origin_agent": "recovery", "affects": ["selection", "allocation"], "status": "deployed",
     "why": "A strategy that stopped working should stop costing money quickly; keeping its paper record running shows when it "
            "works again, so it is not shut out forever."},
    {"id": "watch-half-risk", "title": "Halve the risk of a strategy on watch", "origin_agent": "learning",
     "affects": ["allocation"], "status": "deployed",
     "why": "Between healthy and paused there is a warning zone. Half size limits the damage if the spell continues and still "
            "earns if it ends."},
    {"id": "regime-fit", "title": "Skip signals in regimes the strategy should avoid", "origin_agent": "market",
     "affects": ["selection"], "status": "proposed", "method": "subset",
     "why": "Market Intelligence lists, for each regime, the kinds of strategy that tend to fail there (for example breakouts in "
            "extreme volatility). If the strategies' own histories confirm it, skipping those signals removes losing trades."},
    {"id": "exit-regime-down", "title": "Exit early when the 4h regime turns to a downtrend", "origin_agent": "exit",
     "affects": ["exit", "duration"], "status": "proposed", "method": "exit_on",
     "why": "A long's reason to exist is an up-move. When the regime turns down the thesis is broken; leaving at once may save "
            "part of the stop. But it may also cut winners that dip and recover, so every strategy must test it on its own history."},
]
DEPLOYABLE = {"news-veto", "corr-limit", "pause-on-drawdown", "watch-half-risk", "regime-fit"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def ensure(conn) -> None:
    """Writes the agents' starting proposals once. Later status changes are never overwritten here."""
    for s in SEED:
        conn.execute(
            """insert into intel.spot_improvements (id, title, origin_agent, affects, why, status, evidence, history)
               values (%s, %s, %s, %s, %s, %s, %s, %s) on conflict (id) do nothing""",
            (s["id"], s["title"], s["origin_agent"], Jsonb(s["affects"]), s["why"], s["status"],
             Jsonb({"method": s.get("method", "forward")}),
             Jsonb([{"at": _now().isoformat(), "status": s["status"],
                     "note": "Owner rule from the start, measured on its own forward record." if s["status"] == "deployed"
                     else f"Proposed by {s['origin_agent']}."}])))


def active_rules(conn) -> dict:
    rows = dict(conn.execute("select id, status from intel.spot_improvements").fetchall())
    return {k: rows.get(k) == "deployed" for k in DEPLOYABLE}


def set_status(conn, iid: str, status: str, note: str, evidence: dict | None = None, reviews: list | None = None) -> None:
    row = conn.execute("select status, history, evidence from intel.spot_improvements where id = %s", (iid,)).fetchone()
    if not row:
        return
    old, history, ev = row
    changed = old != status
    history = list(history or []) + ([{"at": _now().isoformat(), "status": status, "from": old, "note": note}] if changed else [])
    conn.execute("""update intel.spot_improvements set status = %s, history = %s, evidence = %s, reviews = coalesce(%s, reviews),
                    version = version + %s, updated_at = now() where id = %s""",
                 (status, Jsonb(history), Jsonb({**(ev or {}), **(evidence or {})}), Jsonb(reviews) if reviews is not None else None,
                  1 if changed else 0, iid))


def review_verdict(n: int, delta: float, fold_share: float | None = None) -> str:
    """One agent's review of a change on its own strategy's numbers."""
    if n < MIN_FORWARD:
        return "defer"
    if delta > 0 and (fold_share is None or fold_share >= 0.7):
        return "accept"
    if delta < 0:
        return "reject"
    return "defer"


def combine(reviews: list[dict]) -> tuple[str, str]:
    """accept/reject/defer from all reviewers -> (result, explanation). Disagreement is a conflict, never a promotion.
    A reviewer the change does not touch at all ("not_affected") abstains."""
    votes = [r["verdict"] for r in reviews if r["verdict"] != "not_affected"]
    if not votes:
        return "defer", "The change does not affect any strategy's trades."
    acc, rej = votes.count("accept"), votes.count("reject")
    if acc and rej:
        return "conflict", f"{acc} strategies improve but {rej} get worse: conflicting results, not promoted."
    if acc and acc >= max(1, len(votes) // 2):
        return "accept", f"{acc} of {len(votes)} reviewers accept; none reject."
    if rej and rej >= max(1, len(votes) // 2):
        return "reject", f"{rej} of {len(votes)} reviewers reject."
    return "defer", "Not enough evidence yet."


# ---- forward-measured rules (deployed from the start, rolled back if they hurt) -------------------------------------------
def review_forward(conn) -> None:
    """Every blocked signal is scored when its trade ends. A rule whose blocked trades win on average is costing money."""
    rows = conn.execute("""select v->'by' as by, t.strategy_id, t.r from intel.spot_agent_decisions d, jsonb_array_elements(d.vetoed) v
                           join intel.spot_paper_trades t on t.id = v->>'id' where t.status = 'closed'""").fetchall()
    by_agent = {"news-veto": "news", "corr-limit": "risk"}
    for iid, agent in by_agent.items():
        hit = [(sid, float(r)) for by, sid, r in rows if agent in (by or [])]
        reviews = []
        for sid in sorted({s for s, _ in hit}):
            rs = [r for s, r in hit if s == sid]
            # for a veto, a NEGATIVE average R of the blocked trades means the veto helped
            reviews.append({"by": sid, "verdict": review_verdict(len(rs), -float(np.mean(rs))), "n": len(rs),
                            "blocked_avg_r": round(float(np.mean(rs)), 3)})
        n = len(hit)
        avg = float(np.mean([r for _, r in hit])) if hit else None
        ev = {"blocked_closed": n, "blocked_avg_r": None if avg is None else round(avg, 3)}
        status = conn.execute("select status from intel.spot_improvements where id = %s", (iid,)).fetchone()
        if not status or status[0] != "deployed":
            continue
        if n >= MIN_FORWARD and avg is not None and avg > ROLLBACK_AVG_R:
            set_status(conn, iid, "rolled_back", f"The {n} trades it blocked averaged {avg:+.2f}R: the rule was costing money.", ev, reviews)
        else:
            set_status(conn, iid, "deployed", "", ev, reviews)


# ---- backtest cross-tests (each strategy tests the change on its own history) -----------------------------------------
def _folds_share(base: pd.DataFrame, var: pd.DataFrame, k: int = 6) -> float | None:
    if base.empty or var.empty:
        return None
    t0, t1 = base["entry_at"].min(), base["entry_at"].max()
    edges = pd.date_range(t0, t1, periods=k + 1)
    wins = total = 0
    for a, b in zip(edges[:-1], edges[1:]):
        x = base[(base["entry_at"] >= a) & (base["entry_at"] < b)]["r"]
        y = var[(var["entry_at"] >= a) & (var["entry_at"] < b)]["r"]
        if len(x) < 5 or len(y) < 5:
            continue
        total += 1
        wins += int(y.sum() >= x.sum())
    return wins / total if total else None


def cross_test(conn, load, force: bool = False) -> list[str]:
    """load(sym) -> (sig4h, ctx1d) or None. Runs each backtestable proposal on every swing strategy's own history.
    Returns the ids that were tested. At most once a week (the history only grows by 42 bars a week)."""
    from engine.spot import backtest as bt
    from engine.spot.data import SYMBOLS, UNSEEN
    from engine.spot.market import RECOMMEND
    from engine.spot.paper import GROUPS
    from engine.spot.strategies import BY_ID, prepare
    from engine.spot.agents import FAMILY_TAGS

    done = []
    rows = conn.execute("select id, status, evidence from intel.spot_improvements where evidence->>'method' in ('subset', 'exit_on')").fetchall()
    for iid, status, ev in rows:
        if status in ("rejected", "rolled_back", "approved", "deployed"):
            continue
        last = (ev or {}).get("tested_at")
        if not force and last and _now() - datetime.fromisoformat(last) < CROSS_TEST_EVERY:
            continue
        reviews = []
        for sid in GROUPS["4h"]:
            spec = BY_ID[sid]
            base_all, var_all = [], []
            for sym in SYMBOLS + UNSEEN:
                pair = load(sym)
                if pair is None:
                    continue
                f = prepare(*pair, spec)
                base = bt.run(f, spec)
                if base.empty:
                    continue
                if ev.get("method") == "exit_on":
                    var = bt.run(f, spec, exit_on="regime_down")
                else:
                    tags = FAMILY_TAGS.get(spec.family, [])
                    bad = {r for r, (_, avoid) in RECOMMEND.items() if "all" in avoid or any(t in avoid for t in tags)}
                    var = base[~base["regime"].isin(bad)]
                base_all.append(base)
                var_all.append(var)
            if not base_all:
                continue
            b, v = pd.concat(base_all), pd.concat(var_all)
            delta = float(v["r"].sum() - b["r"].sum()) / max(1, len(b))      # total R change per baseline trade
            share = _folds_share(b, v)
            same = len(v) == len(b) and abs(float(v["r"].sum()) - float(b["r"].sum())) < 1e-9
            reviews.append({"by": sid, "verdict": "not_affected" if same else review_verdict(len(v), delta, share),
                            "n": int(len(v)), "baseline_n": int(len(b)),
                            "baseline_total_r": round(float(b["r"].sum()), 2), "variant_total_r": round(float(v["r"].sum()), 2),
                            "delta_r_per_trade": round(delta, 4), "folds_better": None if share is None else round(share, 2)})
        result, why = combine(reviews)
        ev2 = {"tested_at": _now().isoformat(), "result": result, "summary": why}
        if result == "reject":
            set_status(conn, iid, "rejected", "Cross-test: " + why, ev2, reviews)
        elif result == "conflict":
            set_status(conn, iid, "deferred", "Cross-test: " + why, ev2, reviews)
        elif result == "accept":
            set_status(conn, iid, "walk_forward_tested",
                       "Cross-test: " + why + " Next: it must be tracked on paper as a new strategy version before any approval.", ev2, reviews)
        else:
            set_status(conn, iid, "backtested", "Cross-test: " + why, ev2, reviews)
        done.append(iid)
    return done


def listing(conn) -> list[dict]:
    rows = conn.execute("""select id, title, origin_agent, affects, why, status, version, evidence, reviews, history, updated_at
                           from intel.spot_improvements order by created_at, id""").fetchall()
    keys = ["id", "title", "origin", "affects", "why", "status", "version", "evidence", "reviews", "history", "updated_at"]
    return [{**dict(zip(keys, r)), "updated_at": str(r[-1])} for r in rows]
