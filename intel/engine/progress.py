"""Writes AI-NUMBERS.md at the project root: the AI's real numbers, updated by the engine, so the owner can read them at any time. Test accounts are never counted."""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

from . import db, learning
from .settings import ROOT

OUT = ROOT / "AI-NUMBERS.md"
LONG_MODEL_LIVE = "2026-11-07 05:28:12+00"
REAL = "u.email not like '%@test.local' and u.email not like '%.invalid' and u.email not like 'engine@%'"


def _saved(name: str) -> dict | None:
    try:
        return json.loads((ROOT / "docs" / "intel" / name).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _money(x: float) -> str:
    return f"{'+' if x >= 0 else '-'}α{abs(x):,.2f}"


def _pct(won: int, n: int) -> str:
    return f"{won / n:.1%}" if n else "none yet"


def _table(rows: list[tuple]) -> list[str]:
    out = ["| Who | Trade type | Finished | Won | Won % | Profit |", "|---|---|---:|---:|---:|---:|"]
    out += [f"| {r[0]} | {r[1]} | {r[2]:,} | {r[3]:,} | {_pct(r[3], r[2])} | {_money(float(r[4] or 0))} |" for r in rows]
    return out if rows else ["No finished trades yet."]


def build(now: datetime) -> str:
    r = learning.report()
    last, clean = r["last_100"], r["picks"]["clean"]
    with db.connect() as c:
        real = c.execute(
            f"""select case when t.auto or t.idea_id is not null then 'AI, on real accounts' else 'People, by hand' end, t.mode, count(*), count(*) filter (where t.pnl > 0), sum(t.pnl)
                from trades t join auth.users u on u.id = t.user_id where t.status <> 'open' and {REAL} group by 1, 2 order by 1, 2""").fetchall()
        night = c.execute(
            f"""select 'AI, on real accounts', t.mode, count(*), count(*) filter (where t.pnl > 0), sum(t.pnl)
                from trades t join auth.users u on u.id = t.user_id where t.status <> 'open' and t.auto and t.close_time > now() - interval '12 hours' and {REAL} group by 2 order by 2""").fetchall()
        new_model = c.execute(
            f"""select 'AI, on real accounts', t.mode, count(*), count(*) filter (where t.pnl > 0), sum(t.pnl)
                from trades t join auth.users u on u.id = t.user_id where t.status <> 'open' and t.auto and t.mode = 'inzone' and t.open_time >= '{LONG_MODEL_LIVE}' and {REAL} group by 2""").fetchall()
        open_now = c.execute(
            f"""select t.mode, t.auto, count(*), sum(t.amount) from trades t join auth.users u on u.id = t.user_id where t.status = 'open' and {REAL} group by 1, 2 order by 1, 2""").fetchall()
    lines = [
        "# Oliskey Alpha: the AI's real numbers", "",
        f"Updated by the engine {now:%Y-%m-%d %H:%M} UTC. Demo money on real crypto prices. Test accounts are not counted. It can lose.", "",
        "## Score", "",
        f"**Last {last['finished']} of 100 signals: {last['won']} right, {last['lost']} wrong ({_pct(last['won'], last['finished'])}), {_money(last['pnl'])}.**", "",
        f"Clean record: {clean['finished']} trades across {clean['moments']} separate hours. It needs at least 100 to judge, and even a profit can be luck.", "",
        f"## New InZone model, since it went live on {LONG_MODEL_LIVE[:16]} UTC", "", *_table(new_model), "",
        "It needs at least 100 finished trades before anyone can say it works. Its tests: docs/intel/WIDE_HARDER.md.", "",
        "## Last 12 hours, auto trades on real accounts", "", *_table(night), "",
        "## All time, real accounts", "", *_table(real), "",
        "## Open now, real accounts", "",
    ]
    lines += [f"- {m}, {'AI' if a else 'by hand'}: {n} trades, α{float(s):,.0f} staked" for m, a, n, s in open_now] or ["- None"]
    lines += ["", "## Tests", ""]
    wide = _saved("wide.json")
    if wide:
        lines.append(f"- All-coins contest, {wide['generated_at'][:16]}: winners {wide['picks']}. InZone length: {wide.get('inzone_length')}.")
    else:
        lines.append("- All-coins contest: not finished yet.")
    t = _saved("time.json")
    if t:
        sit = sorted({w for k in t["kinds"].values() for w in k["sit_out"]})
        lines.append(f"- When to trade, {t['generated_at'][:16]}: {t['windows_tried']} windows tested. To sit out: {', '.join(sit) or 'none proved'}.")
    q = _saved("quality.json")
    if q:
        lines.append("- Fewer, stronger trades: " + "; ".join(f"{k}: {v['passing'] or 'none passed'}" for k, v in q["kinds"].items()) + ".")
    s = _saved("stakes.json")
    if s:
        lines.append("- Stake by strength: " + "; ".join(f"{k}: {'passed' if v['passes'] else 'failed'}" for k, v in s["kinds"].items()) + ".")
    lines += ["", "Questions, answers and what is still open: see AI-PROGRESS.md.", ""]
    return "\n".join(lines)


def write() -> None:
    """A problem here must never touch trading."""
    try:
        text = build(datetime.now(timezone.utc))
        temp = OUT.with_suffix(".tmp")
        temp.write_text(text, encoding="utf-8")
        os.replace(temp, OUT)
    except Exception as err:
        print("progress file failed:", err, flush=True)
