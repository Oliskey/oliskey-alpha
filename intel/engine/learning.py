"""The AI trader's learning loop, on demo money and real prices only.

  journal  every finished trade gets its facts and its cause, measured from the real bars around it
  lessons  what the wins and losses have in common
  rules    a repeated losing pattern becomes a "skip" rule ONLY if years of past data confirm it, in both halves of the
           history, clearly worse than other trades. One loss never changes anything: that is how systems learn noise.
  retire   a rule whose skipped trades turn out to make money is removed. Every change is logged with its evidence.

  keep     a strategy whose live profit is clear enough to rule out luck is marked "keeping": no rule may remove it while
           that stays true. If it stops being true, it loses the mark, and the log says so.
  trend    what the market is doing now, from real prices and the Fear & Greed index
  checks   before each trade it reads the news, the market trend and mood, and funding, and records them on the trade. Once one
           proves itself on live results it becomes a rule the trader always follows. Until then it only watches.

It can never promise not to repeat a loss: losing trades are normal. It stops repeating patterns that are proven to lose."""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from statistics import NormalDist

import httpx
import pandas as pd
from psycopg.types.json import Jsonb

from . import backtest as bt, db, news, scout
from .indicators import add_all
from .settings import APP_ASSETS, asset_cfg, variants
from .strategies import split_variant

SCHEMA = """
create table if not exists intel.ai_decisions (
  idea_id bigint primary key references intel.ideas (id) on delete cascade,
  take boolean not null,
  rule_id bigint,
  tags jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists intel.ai_journal (
  idea_id bigint primary key references intel.ideas (id) on delete cascade,
  trade_id uuid not null,
  won boolean not null,
  result_r double precision not null,
  pnl double precision not null,
  cause text not null,
  notes jsonb not null,
  best_r double precision not null,
  worst_r double precision not null,
  tags jsonb not null,
  closed_at timestamptz not null default now()
);
create table if not exists intel.ai_rules (
  id bigserial primary key,
  tag text not null,
  status text not null default 'active' check (status in ('active', 'retired')),
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);
create unique index if not exists ai_rules_one_active on intel.ai_rules (tag) where status = 'active';
alter table intel.ai_decisions add column if not exists details jsonb not null default '[]';
alter table intel.ai_rules add column if not exists kind text not null default 'skip' check (kind in ('skip', 'require'));
create table if not exists intel.ai_status (
  key text primary key,
  status text not null,
  since timestamptz not null default now()
);
create table if not exists intel.ai_log (
  id bigserial primary key,
  kind text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create table if not exists intel.ai_after_trade (
  idea_id bigint primary key references intel.ideas (id) on delete cascade,
  asset_id text not null,
  closed_at timestamptz not null,
  pnl double precision not null,
  won boolean not null,
  total_pnl double precision not null,
  total_trades integer not null,
  total_won integer not null
);
create table if not exists intel.ai_checkpoints (
  id bigserial primary key,
  at timestamptz not null default now(),
  balance double precision,
  total_pnl double precision not null,
  total_trades integer not null,
  total_won integer not null,
  change_pnl double precision,
  change_trades integer,
  change_won integer
);
"""

MIN_LIVE = 20          # finished live trades with a pattern before it is even considered
MIN_HISTORY = 200      # past trades with that pattern needed to confirm it
MAX_SKIPPED = 0.6      # rules may never skip more than this share of setups: that would mean "no edge", not "a lesson"
RETIRE_AFTER = 20      # skipped trades that finished before a rule can be judged
TOO_FEW = 100          # below this the page says the record is too short to judge
MIN_TO_KEEP = 30       # finished live trades before a strategy can earn "keeping"
MIN_CHECK_LIVE = 50    # a check has no long history to confirm it, so it needs more live trades
CHECK_FAMILIES = ("news", "market", "mood", "funding")
Z = NormalDist().inv_cdf(1 - 0.05 / 30)   # about 30 patterns can be tried

CAUSES = {
    "reached_target": "Reached its target.",
    "fixed_right": "Fixed Time: the price ended on the side it expected.",
    "fixed_wrong": "Fixed Time: the price ended on the other side.",
    "zone_right": "InZone: the price finished inside the corridor.",
    "zone_wrong": "InZone: the price finished outside the corridor.",
    "time_win": "Closed in profit at the time limit.",
    "stop_too_close": "Right direction, stop too close: it hit the stop, then reached the target within the time limit.",
    "turned_back": "Nearly right, then turned: it got most of the way to the size of the stop in profit, then reversed to the stop.",
    "wrong_from_start": "Wrong from the start: the price barely moved in the trade's favour.",
    "normal_stop": "Normal stop-out: it moved a little in favour, then reached the stop.",
    "time_loss": "Ran out of time at a loss: neither the stop nor the target was reached.",
}
LABEL = {
    "trend:against": "Trading against the long-term trend", "trend:with": "Trading with the long-term trend",
    "vol:high": "Very jumpy market", "vol:normal": "Normal market movement", "vol:low": "Quiet market",
    "session:asia": "Asia hours", "session:europe": "Europe hours", "session:us": "US hours",
    "day:weekend": "Weekend", "day:weekday": "Weekday", "side:up": "Up trades", "side:down": "Down trades",
    "tf:1h": "1-hour chart", "tf:4h": "4-hour chart", "tf:1d": "Daily chart",
    "setup:updown": "Fixed Time 60-minute", "tf:1m": "1-minute data",
    "setup:trend_pullback": "Trend pullback setups", "setup:breakout": "Breakout setups", "setup:mean_reversion": "Mean reversion setups",
    "news:with": "News agrees with the trade", "news:against": "News disagrees with the trade", "news:mixed": "News is mixed", "news:quiet": "No recent news",
    "news:busy": "Lots of recent news",
    "market:with": "Trading with the market trend", "market:against": "Trading against the market trend", "market:mixed": "Market trend is mixed",
    "mood:fear": "Market mood is fearful", "mood:greed": "Market mood is greedy", "mood:neutral": "Market mood is neutral",
    "funding:crowded": "Most traders are already on this side", "funding:opposite": "Most traders are on the other side", "funding:calm": "Traders are balanced",
    "coins:outside_training": "Coins outside its training", "setup:inzone": "InZone", "regime:trend_up": "Rising market", "regime:trend_down": "Falling market", "regime:range": "Sideways market", "regime:chaos": "Wild market",
}


def label(tag: str) -> str:
    return LABEL.get(tag, tag.replace("combo:", "").replace("+", " in ").replace("_", " "))


def ensure() -> None:
    with db.connect() as c:
        c.execute(SCHEMA)
    scout.ensure()


def tags_for(row: pd.Series, direction: int, strategy: str, regime: str, tf: str, when: pd.Timestamp) -> list[str]:
    """What was true when the trade was decided. Only uses that bar and earlier ones."""
    base = split_variant(strategy)[0]
    long_trend = 1 if row["close"] > row["ema200"] else -1
    rank = row["atr_pct_rank"]
    hour = when.hour
    return [
        f"setup:{base}", f"regime:{regime}", f"combo:{base}+{regime}", f"tf:{tf}", f"side:{'up' if direction > 0 else 'down'}",
        f"trend:{'with' if direction == long_trend else 'against'}",
        f"vol:{'high' if rank > 0.8 else 'low' if rank < 0.2 else 'normal'}",
        f"session:{'asia' if hour < 8 else 'europe' if hour < 14 else 'us'}",
        f"day:{'weekend' if when.weekday() >= 5 else 'weekday'}",
    ]


def find_cause(direction: int, entry: float, stop: float, target: float, status: str, bars: pd.DataFrame, exit_after: int) -> tuple[str, float, float]:
    """From the real bars after entry: (cause, best move, worst move), moves in units of the stop distance."""
    risk = abs(entry - stop)
    held = bars.iloc[:exit_after + 1]
    if held.empty:
        return ("reached_target" if status == "won" else "time_loss" if status == "expired" else "normal_stop"), 0.0, 0.0
    fav = (held["high"] - entry) if direction > 0 else (entry - held["low"])
    adv = (entry - held["low"]) if direction > 0 else (held["high"] - entry)
    best, worst = float(fav.max() / risk), float(adv.max() / risk)
    if status == "won":
        return "reached_target", best, worst
    if status == "expired":
        return ("time_win" if direction * (held["close"].iat[-1] - entry) > 0 else "time_loss"), best, worst
    later = bars.iloc[exit_after + 1:]
    came_back = bool(((later["high"] >= target) if direction > 0 else (later["low"] <= target)).any()) if len(later) else False
    if came_back:
        return "stop_too_close", best, worst
    if best >= 0.7:
        return "turned_back", best, worst
    if best < 0.25:
        return "wrong_from_start", best, worst
    return "normal_stop", best, worst


def should_adopt(live_n: int, live_avg: float, tagged: pd.Series, rest: pd.Series, first_half: pd.Series, second_half: pd.Series, share_skipped: float) -> tuple[bool, str]:
    """The gate every rule must pass. `tagged`/`rest` are past results in R with and without the pattern."""
    if live_n < MIN_LIVE or live_avg >= 0:
        return False, "not enough live losses with this pattern yet"
    if len(tagged) < MIN_HISTORY:
        return False, f"only {len(tagged)} past trades with this pattern"
    if not (first_half.mean() < 0 and second_half.mean() < 0):
        return False, "it did not lose in both halves of the past data"
    se = math.sqrt(tagged.var(ddof=1) / len(tagged) + rest.var(ddof=1) / max(len(rest), 2))
    if not tagged.mean() + Z * se < rest.mean():
        return False, "past trades with this pattern were not clearly worse than the others"
    if share_skipped > MAX_SKIPPED:
        return False, "the rules would skip most setups, which means no real edge rather than one fixable mistake"
    return True, "confirmed"


def _say(kind: str, message: str) -> None:
    with db.connect() as c:
        c.execute("insert into intel.ai_log (kind, message) values (%s, %s)", (kind, message))


def _funding_now(asset: str) -> float | None:
    """The latest real funding rate saved by the research, for the coins it covers."""
    import json
    import os
    from pathlib import Path
    symbol = asset.replace("USD", "USDT")
    path = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "oliskey-alpha" / "updown-cache" / f"{symbol}_funding.json"
    try:
        rows = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return float(rows[-1][1]) if rows else None


def checks_for(asset: str, direction: int | None) -> tuple[list[str], list[str]]:
    """What it reads before a trade: tags to learn from, and plain lines to show. direction None: InZone, which has no side."""
    tags, lines = [], []
    n = news.view(asset)
    if direction is None:
        tags.append("news:busy" if n["count"] >= 5 else "news:quiet")
    else:
        agrees = direction * n["score"]
        tags.append("news:quiet" if not n["count"] else "news:with" if agrees > 0 else "news:against" if agrees < 0 else "news:mixed")
    lines.append(f"News, last 6 hours: {n['count']} headlines, {n['good']} good, {n['bad']} bad." if n["count"] else "News, last 6 hours: none on this coin or the market.")
    trend = _market.get("trend")
    if trend:
        lines.append(f"Market trend: {trend}, {_market['above']} of {_market['total']} coins above their long-term average.")
        if direction is not None:
            tags.append("market:mixed" if trend == "mixed" else "market:with" if (trend == "rising") == (direction > 0) else "market:against")
    fear = _market.get("fear")
    if fear:
        tags.append("mood:fear" if fear["value"] <= 40 else "mood:greed" if fear["value"] >= 60 else "mood:neutral")
        lines.append(f"Market mood: {fear['text']} ({fear['value']} of 100).")
    rate = _funding_now(asset)
    if rate is not None and direction is not None:
        crowded = abs(rate) >= 0.0002
        tags.append("funding:calm" if not crowded else "funding:crowded" if (rate > 0) == (direction > 0) else "funding:opposite")
        lines.append(f"Funding rate: {rate * 100:+.3f}%" + (", most traders are on one side." if crowded else ", traders are balanced."))
    return tags, lines


def blocked_by(tags: list[str], rules: list[tuple]) -> int | None:
    """The rule stopping this trade, if any. A require rule only applies when the trade has a reading from that check."""
    for rid, tag, kind in rules:
        if kind == "skip" and tag in tags:
            return rid
        if kind == "require":
            family = tag.split(":")[0] + ":"
            if any(t.startswith(family) for t in tags) and tag not in tags:
                return rid
    return None


def decide() -> int:
    """Each new setup gets a decision before the trader may act on it. Skipped setups still resolve, so a rule can be judged."""
    with db.connect() as c:
        rows = c.execute(
            """select i.id, i.asset_id, i.strategy, i.regime, i.direction, i.tf, i.bar_time, i.asset_class from intel.ideas i
               left join intel.ai_decisions d on d.idea_id = i.id where d.idea_id is null and i.status = 'open'""").fetchall()
        rules = c.execute("select id, tag, kind from intel.ai_rules where status = 'active'").fetchall()
    for iid, asset, strategy, regime, direction, tf, bar_time, cls in rows:
        if tf == "1m":   # Fixed Time and InZone signals have no chart setup to judge
            tags = ["setup:updown" if cls.startswith("crypto_ft") else "setup:inzone", "tf:1m"]
            if cls.endswith("_wide"):
                tags.append("coins:outside_training")
        else:
            df = add_all(db.load_bars(asset, tf))
            past = df[df.index < bar_time]
            if past.empty:
                continue
            tags = tags_for(past.iloc[-1], direction, strategy, regime, tf, past.index[-1])
        extra, lines = checks_for(asset, None if cls.startswith("crypto_iz") else direction)
        tags += extra
        hit = blocked_by(tags, rules)
        with db.connect() as c:
            c.execute("insert into intel.ai_decisions (idea_id, take, rule_id, tags, details) values (%s, %s, %s, %s, %s) on conflict do nothing", (iid, hit is None, hit, Jsonb(tags), Jsonb(lines)))
    return len(rows)


def warnings(tags: list[str]) -> list[str]:
    """What its checks warned about when it took the trade, so a loss can be traced back to them."""
    return [label(t) for t in tags if t in ("news:against", "market:against", "funding:crowded", "news:busy")]


def write_journal() -> int:
    """Every finished demo trade: its result and why, measured from real bars."""
    with db.connect() as c:
        rows = c.execute(
            """select i.id, p.trade_id, i.asset_id, i.tf, i.direction, i.entry, i.stop, i.target, i.status, i.result_r, i.bar_time,
                      i.resolved_at, i.strategy, i.regime, i.asset_class, t.pnl
               from intel.paper_trades p join intel.ideas i on i.id = p.idea_id join public.trades t on t.id = p.trade_id
               left join intel.ai_journal j on j.idea_id = i.id
               where j.idea_id is null and t.status = 'closed' and i.status <> 'open'""").fetchall()
    done = 0
    for iid, trade_id, asset, tf, direction, entry, stop, target, status, result_r, bar_time, resolved_at, strategy, regime, cls, pnl in rows:
        with db.connect() as c:
            d = c.execute("select tags from intel.ai_decisions where idea_id = %s", (iid,)).fetchone()
        checked = list(d[0]) if d else []
        if tf == "1m":   # no chart levels: it ended right or wrong at the close
            cause = ("zone_right" if float(pnl) > 0 else "zone_wrong") if cls.startswith("crypto_iz") else ("fixed_right" if float(pnl) > 0 else "fixed_wrong")
            with db.connect() as c:
                c.execute("""insert into intel.ai_journal (idea_id, trade_id, won, result_r, pnl, cause, notes, best_r, worst_r, tags, closed_at)
                             values (%s, %s, %s, %s, %s, %s, %s, 0, 0, %s, %s) on conflict do nothing""",
                          (iid, trade_id, float(pnl) > 0, float(result_r or 0), float(pnl), cause, Jsonb(warnings(checked)), Jsonb(checked), resolved_at))
            done += 1
            continue
        full = add_all(db.load_bars(asset, tf))
        step = bt_step(tf)
        after = full[full.index >= bar_time].iloc[:asset_cfg(asset, cls)["horizon_bars"]]
        exit_after = max(int((after.index < resolved_at).sum()) - 1, 0)
        cause, best, worst = find_cause(direction, entry, stop, target, status, after, exit_after)
        past = full[full.index < bar_time]
        tags = tags_for(past.iloc[-1], direction, strategy, regime, tf, past.index[-1]) if len(past) else []
        tags += [t for t in checked if t not in tags]
        with db.connect() as c:
            same_day = c.execute("select count(*) from intel.ai_journal where not won and closed_at::date = %s::date", (resolved_at,)).fetchone()[0]
            notes = [label(t) for t in tags if t in ("trend:against", "vol:high")] + warnings(tags)
            if not float(pnl) > 0 and same_day >= 2:
                notes.append(f"Market-wide move: {same_day} other trades lost the same day")
            c.execute(
                """insert into intel.ai_journal (idea_id, trade_id, won, result_r, pnl, cause, notes, best_r, worst_r, tags, closed_at)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) on conflict do nothing""",
                (iid, trade_id, float(pnl) > 0, float(result_r or 0), float(pnl), cause, Jsonb(notes), best, worst, Jsonb(tags), resolved_at))
        done += 1
        _ = step
    after_trades()
    return done


def running_totals(pnl: float, won: bool, total: tuple[float, int, int]) -> tuple[float, int, int]:
    """After one finished trade: total profit, trades and wins so far."""
    return total[0] + pnl, total[1] + 1, total[2] + (1 if won else 0)


def after_trades() -> int:
    """The calculation after every finished trade: where its own picks stand now that this one has closed."""
    with db.connect() as c:
        rows = c.execute(
            """select j.idea_id, i.asset_id, j.closed_at, j.pnl, j.won from intel.ai_journal j join intel.ideas i on i.id = j.idea_id
               left join intel.ai_after_trade a on a.idea_id = j.idea_id
               where i.kind = 'idea' and a.idea_id is null order by j.closed_at, j.idea_id""").fetchall()
        last = c.execute("select total_pnl, total_trades, total_won from intel.ai_after_trade order by total_trades desc limit 1").fetchone()
    total = tuple(last) if last else (0.0, 0, 0)
    for iid, asset, closed, pnl, won in rows:
        total = running_totals(pnl, won, total)
        with db.connect() as c:
            c.execute("insert into intel.ai_after_trade values (%s, %s, %s, %s, %s, %s, %s, %s) on conflict do nothing", (iid, asset, closed, pnl, won, *total))
    return len(rows)


def checkpoint_due(last: datetime | None, now: datetime) -> bool:
    return last is None or (now - last).total_seconds() >= CHECK_EVERY_HOURS * 3600


def money(v: float) -> str:
    return f"{'+' if v >= 0 else '-'}α{abs(v):,.2f}"


def twelve_hour_check() -> bool:
    """Every 12 hours: the balance now against the last check, to see if it is really making more than it loses. Profit is counted
    from finished trades, because a demo top-up would otherwise look like profit. If the PC was off, it runs as soon as it is back."""
    now = datetime.now(timezone.utc)
    with db.connect() as c:
        last = c.execute("select at, total_pnl, total_trades, total_won from intel.ai_checkpoints order by id desc limit 1").fetchone()
        if not checkpoint_due(last[0] if last else None, now):
            return False
        total = c.execute("select total_pnl, total_trades, total_won from intel.ai_after_trade order by total_trades desc limit 1").fetchone() or (0.0, 0, 0)
        row = c.execute("""select a.balance from public.accounts a where a.id = (select t.account_id from intel.paper_trades p join public.trades t on t.id = p.trade_id order by p.created_at desc limit 1)""").fetchone()
        balance = float(row[0]) if row else None
        change = (total[0] - last[1], total[1] - last[2], total[2] - last[3]) if last else (None, None, None)
        c.execute("insert into intel.ai_checkpoints (balance, total_pnl, total_trades, total_won, change_pnl, change_trades, change_won) values (%s, %s, %s, %s, %s, %s, %s)", (balance, *total, *change))
    if last:
        word = "Making more than it loses" if change[0] > 0 else "Losing more than it makes" if change[0] < 0 else "No change"
        _say("check", f"{CHECK_EVERY_HOURS}-hour check: {word.lower()}. {money(change[0])} from {change[1]} finished trades, {change[2]} won. Total so far {money(total[0])}." + (f" Balance α{balance:,.2f}." if balance is not None else ""))
    return True


def bt_step(tf: str) -> timedelta:
    return {"1h": timedelta(hours=1), "4h": timedelta(hours=4), "1d": timedelta(days=1)}[tf]


def history() -> pd.DataFrame:
    """Years of real past trades with their patterns, for confirming a rule. One target size, so each signal counts once."""
    frames = []
    for asset in APP_ASSETS:
        for cls in variants(asset):
            if not cls.startswith("crypto"):
                continue
            cfg = asset_cfg(asset, cls)
            bars = db.load_bars(asset, cfg["timeframe"])
            if len(bars) < 500:
                continue
            t = bt.simulate(asset, cls, bars, cfg["horizon_bars"], cfg["cost_pct"])
            t = t[t["reward"] == 1.5]
            if t.empty:
                continue
            df = add_all(bars)
            t = t.assign(tags=[tags_for(df.loc[s], d, st, reg, cfg["timeframe"], s) for s, d, st, reg in zip(t["signal_time"], t["direction"], t["strategy"], t["regime"])])
            frames.append(t[["signal_time", "r", "tags"]])
    return pd.concat(frames, ignore_index=True).sort_values("signal_time") if frames else pd.DataFrame(columns=["signal_time", "r", "tags"])


def strategy_status(results: list[float]) -> str:
    """From a strategy's own picks, in R. Keeping needs the 95% lower bound above zero, so a lucky week cannot earn it."""
    n = len(results)
    if n < MIN_TO_KEEP:
        return "too_few"
    mean = sum(results) / n
    se = math.sqrt(sum((r - mean) ** 2 for r in results) / (n - 1) / n)
    if mean - 1.96 * se > 0:
        return "keeping"
    return "struggling" if mean + 1.96 * se < 0 else "unclear"


STATUS_WORDS = {"keeping": "Keeping", "struggling": "Struggling", "unclear": "Unclear so far"}


def review_strategies() -> set[str]:
    """Marks each strategy from its own picks, logs any change, and returns the setups being kept."""
    with db.connect() as c:
        rows = c.execute(
            """select j.tags, j.result_r, i.tf from intel.ai_journal j join intel.ideas i on i.id = j.idea_id where i.kind = 'idea' and not (i.id = any(%s))""", (list(off_test_trades()),)).fetchall()
        known = dict(c.execute("select key, status from intel.ai_status").fetchall())
    groups: dict[tuple[str, str], list[float]] = {}
    for tags, r, tf in rows:
        setup = next((t.split(":")[1] for t in tags if t.startswith("setup:")), "other")
        groups.setdefault((setup, tf), []).append(r)
    kept = set()
    for (setup, tf), results in groups.items():
        status, key = strategy_status(results), f"{setup}|{tf}"
        if status == "keeping":
            kept.add(setup)
        if status != known.get(key, "too_few") and status != "too_few":
            mean = sum(results) / len(results)
            name = label(f"setup:{setup}").replace(" setups", "")
            _say("kept" if status == "keeping" else "review", f"{name} on the {tf} chart is now \"{STATUS_WORDS[status]}\": {len(results)} live trades averaged {mean:+.2f}R." + (" It will stick with this while that stays true." if status == "keeping" else ""))
            with db.connect() as c:
                c.execute("insert into intel.ai_status (key, status) values (%s, %s) on conflict (key) do update set status = excluded.status, since = now()", (key, status))
    return kept


_market: dict = {}


def refresh_market() -> None:
    """The trend right now, from real data: how many live coins are above their long-term average, and market sentiment."""
    above, total = 0, 0
    for asset in APP_ASSETS:
        if not any(c == "crypto" for c in variants(asset)):
            continue
        bars = db.load_bars(asset, "4h")
        if len(bars) < 250:
            continue
        row = add_all(bars).iloc[-1]
        above += 1 if row["close"] > row["ema200"] else 0
        total += 1
    if not total:
        return
    fear = None
    try:
        data = httpx.get("https://api.alternative.me/fng/?limit=1", timeout=10).raise_for_status().json()["data"][0]
        fear = {"value": int(data["value"]), "text": data["value_classification"]}
    except (httpx.HTTPError, KeyError, ValueError, IndexError):
        fear = _market.get("fear")
    share = above / total
    trend = "rising" if share >= 0.65 else "falling" if share <= 0.35 else "mixed"
    if _market.get("trend") and _market["trend"] != trend:
        _say("trend", f"The crypto market turned {trend}: {above} of {total} coins are above their long-term average.")
    _market.update({"trend": trend, "above": above, "total": total, "fear": fear, "at": datetime.now(timezone.utc).isoformat()})


def check_verdict(tagged: list[float], rest: list[float]) -> str | None:
    """Has this check proved itself on live trades alone? 'require' or 'skip', judged in both halves so one good week cannot do it."""
    if len(tagged) < MIN_CHECK_LIVE or len(rest) < 10:
        return None
    n, mean = len(tagged), sum(tagged) / len(tagged)
    se = math.sqrt(sum((r - mean) ** 2 for r in tagged) / (n - 1) / n)
    rest_mean = sum(rest) / len(rest)
    half = n // 2
    first, second = sum(tagged[:half]) / half, sum(tagged[half:]) / (n - half)
    if mean - Z * se > 0 and mean > rest_mean and first > 0 and second > 0:
        return "require"
    if mean + Z * se < 0 and mean < rest_mean and first < 0 and second < 0:
        return "skip"
    return None


def adopt_checks(live: dict[str, list[float]], journal: list) -> None:
    """A check that has proved itself becomes a rule the trader always follows; one that stops working is removed."""
    with db.connect() as c:
        current = c.execute("select id, tag, kind from intel.ai_rules where status = 'active'").fetchall()
    active = {r[1] for r in current}
    for tag, results in live.items():
        family = tag.split(":")[0]
        if family not in CHECK_FAMILIES or tag in active:
            continue
        rest = [r for tags, r in journal if tag not in tags and any(t.startswith(family + ":") for t in tags)]
        kind = check_verdict(results, rest)
        if not kind:
            continue
        mean = sum(results) / len(results)
        with db.connect() as c:
            c.execute("insert into intel.ai_rules (tag, kind, evidence) values (%s, %s, %s) on conflict do nothing", (tag, kind, Jsonb({"live_trades": len(results), "live_avg_r": mean, "others_avg_r": sum(rest) / len(rest)})))
        _say("adopted", (f"New check, always used from now on: only trade when \"{label(tag)}\"." if kind == "require" else f"New check, always used from now on: skip when \"{label(tag)}\".") + f" {len(results)} live trades averaged {mean:+.2f}R against {sum(rest) / len(rest):+.2f}R for the others.")
    for rid, tag, kind in current:
        if kind != "require":
            continue
        recent = live.get(tag, [])[-30:]
        if len(recent) >= 30 and sum(recent) / len(recent) <= 0:
            with db.connect() as c:
                c.execute("update intel.ai_rules set status = 'retired', retired_at = now() where id = %s", (rid,))
            _say("retired", f"Stopped requiring \"{label(tag)}\": its last 30 trades no longer made money.")


def learn() -> dict:
    """Propose, confirm or refuse rules from the journal, and retire rules that were wrong."""
    kept = review_strategies()
    promise_check()
    with db.connect() as c:
        journal = c.execute("select tags, result_r from intel.ai_journal where not (idea_id = any(%s))", (list(off_test_trades()),)).fetchall()   # never learn from a trade that was not the tested one
        active = c.execute("select id, tag from intel.ai_rules where status = 'active'").fetchall()
        skipped = c.execute(
            """select d.rule_id, i.result_r from intel.ai_decisions d join intel.ideas i on i.id = d.idea_id
               where not d.take and i.status <> 'open'""").fetchall()
    for rid, tag in active:
        if tag.split(":")[0] in CHECK_FAMILIES:
            continue   # checks are judged in adopt_checks
        results = [r for rule, r in skipped if rule == rid and r is not None]
        if len(results) >= RETIRE_AFTER and sum(results) / len(results) > 0:
            with db.connect() as c:
                c.execute("update intel.ai_rules set status = 'retired', retired_at = now() where id = %s", (rid,))
            _say("retired", f"Stopped skipping \"{label(tag)}\": the {len(results)} trades it skipped would have made money.")

    live: dict[str, list[float]] = {}
    for tags, r in journal:
        for t in tags:
            live.setdefault(t, []).append(r)
    adopt_checks(live, journal)
    candidates = {t: v for t, v in live.items() if len(v) >= MIN_LIVE and sum(v) / len(v) < 0 and t.split(":")[0] not in CHECK_FAMILIES}
    with db.connect() as c:
        current = {r[0] for r in c.execute("select tag from intel.ai_rules where status = 'active'").fetchall()}
    candidates = {t: v for t, v in candidates.items() if t not in current}
    # a rule may never remove a strategy that is working
    for tag in [t for t in candidates if t.startswith(("setup:", "combo:")) and t.split(":")[1].split("+")[0] in kept]:
        del candidates[tag]
        _say("kept", f"Did not skip \"{label(tag)}\": this strategy is working overall, so it sticks with it.")
    if not candidates:
        return {"journal": len(journal), "candidates": 0, "adopted": []}

    h = history()
    mid = h["signal_time"].iloc[len(h) // 2]
    adopted = []
    for tag, v in candidates.items():
        mask = h["tags"].map(lambda ts: tag in ts)
        tagged, rest = h.loc[mask, "r"], h.loc[~mask, "r"]
        blocked = h["tags"].map(lambda ts: tag in ts or bool(current.intersection(ts))).mean()
        ok, why = should_adopt(len(v), sum(v) / len(v), tagged, rest, h.loc[mask & (h["signal_time"] < mid), "r"], h.loc[mask & (h["signal_time"] >= mid), "r"], float(blocked))
        if not ok:
            _say("refused", f"Looked at \"{label(tag)}\" ({len(v)} live trades, losing) but did not change anything: {why}.")
            continue
        evidence = {"live_trades": len(v), "live_avg_r": sum(v) / len(v), "past_trades": len(tagged), "past_avg_r": float(tagged.mean()), "others_avg_r": float(rest.mean()), "share_skipped": float(blocked)}
        with db.connect() as c:
            c.execute("insert into intel.ai_rules (tag, evidence) values (%s, %s) on conflict do nothing", (tag, Jsonb(evidence)))
        current.add(tag)
        adopted.append(tag)
        _say("adopted", f"New rule: skip \"{label(tag)}\". Live: {len(v)} trades averaged {evidence['live_avg_r']:+.2f}R. Past: {len(tagged):,} trades averaged {evidence['past_avg_r']:+.2f}R against {evidence['others_avg_r']:+.2f}R for the others.")
    return {"journal": len(journal), "candidates": len(candidates), "adopted": adopted}


def training_picks() -> dict:
    """Which version won the last training contest, per trade type."""
    import json
    from .settings import INTEL
    try:
        return {k: v.get("name") for k, v in json.loads((INTEL / "models" / "training.json").read_text(encoding="utf-8"))["picks"].items()}
    except (OSError, ValueError, KeyError):
        return {}


def note_training(before: dict, after: dict) -> None:
    """Says what the weekly training contest decided, including when nothing beat the current model."""
    names = {"fixed_time": "Fixed Time", "inzone": "InZone"}
    for kind, name in names.items():
        new = after.get(kind)
        if new and new != before.get(kind):
            _say("research", f"Weekly training: {name} changed to \"{new}\", because it beat the previous model on periods it never trained on.")
        elif new:
            _say("research", f"Weekly training: nothing beat the current {name} model, so it stays.")


def note_research(before: dict, after: dict) -> None:
    """One line per trade type that changed in the weekly research."""
    names = {"fixed_time": "Fixed Time", "inzone": "InZone", "forex": "Forex"}
    for kind, name in names.items():
        for version, new in after.get(kind, {}).items():
            old = before.get(kind, {}).get(version, {})
            if not new.get("trades"):
                continue
            changed = new.get("passed") != old.get("passed")
            moved = abs(new.get("win_rate", 0) - old.get("win_rate", 0)) >= 0.01
            if changed or moved:
                _say("research", f"Weekly research, {name} {version}: won {new['win_rate']:.1%} of {new['trades']:,}, needs {new['breakeven']:.1%}" + (f" (was {old['win_rate']:.1%})." if old.get("win_rate") else ".") + (" It now passes the full test." if new.get("passed") and not old.get("passed") else " It no longer passes." if old.get("passed") and not new.get("passed") else ""))
    _say("research", "Weekly research finished on fresh real data.")


# ── Judging itself: the method behind every decision, written down so it runs without anyone watching ──
METHOD = [
    {"name": "Check the facts before believing a result", "state": "Every finished trade is compared with what was tested. If its corridor or closing price was off, the trade is not counted or learned from."},
    {"name": "Doubt a good run", "state": "Trades opened in the same hour count as one moment, and it needs 100 finished trades before judging itself."},
    {"name": "Fix the test before seeing the answer", "state": "A new rule must pass a test set in advance, on years of real prices. The test is never loosened to let a rule through."},
    {"name": "Find the cause, and don't react to one loss", "state": "Every trade records why it ended. One loss changes nothing."},
    {"name": "Compare what it said with what happened", "state": "Each day it compares its readings with its real results, and says so if it was too confident."},
    {"name": "Admit when it could not see", "state": "If the computer sleeps or goes offline, it records the gap. An old price can never open or close a trade."},
    {"name": "Keep checking the money", "state": "After every finished trade it updates its total. Every 12 hours it compares the money now with the last check, and says plainly if it is losing more than it makes."},
    {"name": "Search for what it does not know", "state": "Every week it searches new research papers and notes ideas to test. Reading an idea changes nothing: it must pass a test first."},
    {"name": "Sit out when unsure", "state": "A trade opens only when the reading clears what is needed to make money after the payout. Otherwise it waits."},
    {"name": "Stick with what is proven", "state": "A strategy with clear live profit is kept, and loses that mark if the profit stops."},
]
GAP_MINUTES = 5            # longer than this without a reading means it could not watch the market
CORRIDOR_TOLERANCE = 0.10  # a live corridor this far from the tested one is not the tested trade
CLOSE_LIMIT = 0.1          # % between the trade's closing price and the real one at that same moment
MIN_MOMENTS = 30           # separate hours before it compares its readings with its results
CHECK_EVERY_HOURS = 12     # how often it compares the money now with the money at the last check


def off_test(cls: str, entry: float, target: float, zone_pct: float | None, close_quote: float | None, real_close: float | None) -> str | None:
    """Why a finished trade is not the trade that was tested, or None. Only a price or corridor that was wrong counts, never the result."""
    tested = abs(target - entry) / entry * 100
    if cls.startswith("crypto_iz") and zone_pct and abs(zone_pct / tested - 1) > CORRIDOR_TOLERANCE:
        return "its corridor was not the tested one"
    if close_quote and real_close and abs(close_quote / real_close - 1) * 100 > CLOSE_LIMIT:
        return "it closed on an old price"
    return None


_real_closes: dict[int, float] = {}


def _real_close(iid: int, asset: str, closed_at: datetime) -> float | None:
    """The real market price at the moment the trade itself closed. Other prices can differ simply because time passed, which
    once threw out a genuine loss. Read once per trade; if the market cannot answer now, it is tried again next time."""
    if iid not in _real_closes:
        end = int(closed_at.timestamp() * 1000)
        try:
            rows = httpx.get("https://api.binance.com/api/v3/klines", params={"symbol": asset.replace("USD", "USDT"), "interval": "1s", "startTime": end - 60_000, "endTime": end - 1, "limit": 60}, timeout=10).raise_for_status().json()
        except httpx.HTTPError:
            return None
        if not rows:
            return None
        _real_closes[iid] = float(rows[-1][4])
    return _real_closes[iid]


def off_test_trades() -> dict[int, str]:
    """The finished Fixed Time and InZone trades that were not what was tested. Results stay on record, but it does not learn from them."""
    with db.connect() as c:
        rows = c.execute(
            """select i.id, i.asset_class, i.entry, i.target, t.zone_pct, t.close_quote, i.asset_id, t.close_time
               from intel.ai_journal j join intel.ideas i on i.id = j.idea_id join public.trades t on t.id = j.trade_id where i.tf = '1m'""").fetchall()
    out = {}
    for iid, cls, entry, target, zone, close, asset, closed_at in rows:
        real = _real_close(iid, asset, closed_at) if close is not None and closed_at else None
        why = off_test(cls, entry, target, float(zone) if zone is not None else None, float(close) if close is not None else None, real)
        if why:
            out[iid] = why
    return out


def _status(key: str) -> str | None:
    with db.connect() as c:
        row = c.execute("select status from intel.ai_status where key = %s", (key,)).fetchone()
    return row[0] if row else None


def _set_status(key: str, status: str) -> None:
    with db.connect() as c:
        c.execute("insert into intel.ai_status (key, status) values (%s, %s) on conflict (key) do update set status = excluded.status, since = now()", (key, status))


def self_check() -> None:
    """Every minute: did it lose sight of the market, and is any finished trade not what was tested?"""
    with db.connect() as c:
        row = c.execute("select since from intel.ai_status where key = 'beat'").fetchone()
    _set_status("beat", "alive")
    if row:
        away = (datetime.now(timezone.utc) - row[0]).total_seconds() / 60
        if away > GAP_MINUTES:
            _say("check", f"It could not watch the market for about {away:.0f} minutes, because the computer was asleep, off or too busy. It made no decisions in that time.")
    bad = len(off_test_trades())
    if str(bad) != (_status("off_test") or "0"):
        _set_status("off_test", str(bad))
        _say("check", f"{bad} finished trades were not what was tested, because a corridor or closing price was off. Their results stay on record, but it does not count or learn from them.")


def overstated(said: float, won: float, moments: int) -> bool:
    """Its readings claimed clearly more than it delivered. Trades in the same hour move together, so each hour counts once."""
    return moments >= MIN_MOMENTS and said - won > 1.96 * math.sqrt(0.25 / moments)


def promise_check() -> None:
    """Each day: what it said against what happened, per trade type. It speaks up when that changes."""
    skip = off_test_trades()
    with db.connect() as c:
        rows = c.execute("select id, asset_class, probability, status, bar_time from intel.ideas where kind = 'idea' and status in ('won', 'lost')").fetchall()
    groups: dict[str, list] = {}
    for iid, cls, p, status, when in rows:
        if iid not in skip:
            groups.setdefault(cls, []).append((p, status == "won", when.replace(minute=0, second=0, microsecond=0)))
    for cls, g in groups.items():
        said, won, moments = sum(x[0] for x in g) / len(g), sum(x[1] for x in g) / len(g), len({x[2] for x in g})
        now = "over" if overstated(said, won, moments) else "fine"
        key = f"promise|{cls}"
        if now != (_status(key) or "fine"):
            _say("check", f"{cls}: its readings said {said:.0%} on average and {won:.0%} really won, over {moments} separate hours. " + ("It has been too confident." if now == "over" else "Its readings match its results again."))
        _set_status(key, now)


def scout_check() -> None:
    """Once a week: search for new research. Any failure only means it tries again at the next check."""
    now = datetime.now(timezone.utc)
    with db.connect() as c:
        row = c.execute("select since from intel.ai_status where key = 'scout'").fetchone()
    if not scout.due(row[0] if row else None, now):
        return
    try:
        got = scout.search()
    except httpx.HTTPError:
        return
    _set_status("scout", "searched")
    _say("research", f"It searched for new research: {got['found']} recent papers, {got['read']} read, {got['ideas']} with an idea to test. An idea changes nothing until it passes a test.")


def _open_by_type() -> list:
    with db.connect() as c:
        return c.execute("""select t.mode::text, count(*) from intel.paper_trades p join public.trades t on t.id = p.trade_id where t.status = 'open' group by 1""").fetchall()


def report() -> dict:
    with db.connect() as c:
        j = c.execute(
            """select j.idea_id, i.asset_id, i.direction, i.tf, j.won, j.result_r, j.pnl, j.cause, j.notes, j.best_r, j.closed_at, j.tags, i.kind
               from intel.ai_journal j join intel.ideas i on i.id = j.idea_id order by j.closed_at desc""").fetchall()
        rules = c.execute("select id, tag, status, evidence, created_at, retired_at from intel.ai_rules order by created_at desc").fetchall()
        log = c.execute("select kind, message, created_at from intel.ai_log order by id desc limit 40").fetchall()
        skipped = c.execute("select count(*) from intel.ai_decisions where not take").fetchone()[0]
    causes: dict[str, int] = {}
    tags: dict[str, list[float]] = {}
    for row in j:
        causes[row[7]] = causes.get(row[7], 0) + 1
        for t in row[11]:
            tags.setdefault(t, []).append(row[5])
    lessons = [{"tag": t, "label": label(t), "trades": len(v), "won": sum(1 for r in v if r > 0), "avg_r": sum(v) / len(v)} for t, v in tags.items() if len(v) >= 10]
    lessons.sort(key=lambda x: x["avg_r"])
    wins = sum(1 for r in j if r[4])
    # Every strategy on every chart, side by side, so people can compare them. Nothing is hidden, including the losers.
    board: dict[tuple[str, str], dict] = {}
    for row in j:
        setup = next((t.split(":")[1] for t in row[11] if t.startswith("setup:")), "other")
        b = board.setdefault((setup, row[3]), {"setup": setup, "label": label(f"setup:{setup}").replace(" setups", ""), "tf": row[3], "trades": 0, "won": 0, "pnl": 0.0, "total_r": 0.0})
        b["trades"] += 1
        b["won"] += 1 if row[4] else 0
        b["pnl"] += row[6]
        b["total_r"] += row[5]
    with db.connect() as c:
        statuses = dict(c.execute("select key, status from intel.ai_status").fetchall())
    strategies = sorted(({**b, "avg_r": b["total_r"] / b["trades"], "too_few": b["trades"] < TOO_FEW, "status": statuses.get(f"{b['setup']}|{b['tf']}")} for b in board.values()), key=lambda b: -b["avg_r"])
    # Its own choices are the result that counts. Trades on setups it had marked "don't enter" only measured that decision.
    picks, measured = [r for r in j if r[12] == "idea"], [r for r in j if r[12] != "idea"]
    off = off_test_trades()
    clean = [r for r in picks if r[0] not in off]
    with db.connect() as c:
        after = c.execute("select asset_id, closed_at, pnl, won, total_pnl from intel.ai_after_trade order by total_trades desc limit 10").fetchall()
        checks = c.execute("select at, balance, total_pnl, change_pnl, change_trades, change_won from intel.ai_checkpoints order by id desc limit 10").fetchall()
    with db.connect() as c:
        rules_now = {r[0]: r[1] for r in c.execute("select tag, kind from intel.ai_rules where status = 'active'").fetchall()}
    def check_state(family: str) -> str:
        on = [f"{'only when' if k == 'require' else 'skips when'}: {label(t).lower()}" for t, k in rules_now.items() if t.startswith(family + ":")]
        return f"Now a rule, {'; '.join(on)}." if on else "Watching. It is recorded on every trade, and becomes a rule only if live results prove it."
    from . import scanner, updown
    fx = max(scanner.forex_readings, key=lambda r: r[1]) if scanner.forex_readings else None
    open_by = {r[0]: r[1] for r in _open_by_type()}
    listening = [
        {"mode": "fixed_time", "name": "Fixed Time", "open": open_by.get("fixed_time", 0), "plain": "Will the price be higher or lower in 60 minutes?", "every": "every minute", **updown.listening.get("fixed_time", {})},
        {"mode": "inzone", "name": "InZone", "open": open_by.get("inzone", 0), "plain": "Will the price finish inside the corridor?", "every": "every minute", **updown.listening.get("inzone", {})},
        {"mode": "forex", "name": "Forex", "open": open_by.get("forex", 0), "plain": "Has a chart setup appeared, and does the model back it?", "every": "every 5 minutes",
         **({"asset": fx[0], "reading": fx[2], "needed": fx[3] + 0.03, "at": _market.get("at")} if fx else {"at": _market.get("at"), "no_setup": True})},
    ]
    return {
        "listening": listening,
        "market": _market or None,
        "headlines": news.latest(),
        "checklist": [
            {"name": "Price moves and technical analysis", "state": "In use. These decide whether a signal exists at all."},
            {"name": "News", "state": check_state("news")},
            {"name": "Market trend", "state": check_state("market")},
            {"name": "Market mood", "state": check_state("mood")},
            {"name": "Funding rates", "state": check_state("funding")},
        ],
        "method": METHOD,
        "findings": scout.latest(),
        "after_trade": [{"asset": r[0], "at": r[1], "pnl": r[2], "won": r[3], "total": r[4]} for r in after],
        "checks_12h": [{"at": r[0], "balance": r[1], "total": r[2], "change": r[3], "trades": r[4], "won": r[5]} for r in checks],
        "picks": {"finished": len(picks), "won": sum(1 for r in picks if r[4]), "lost": sum(1 for r in picks if not r[4]), "pnl": sum(r[6] for r in picks), "too_few": len(clean) < TOO_FEW,
                  "clean": {"finished": len(clean), "won": sum(1 for r in clean if r[4]), "pnl": sum(r[6] for r in clean), "moments": len({r[10].replace(minute=0, second=0, microsecond=0) for r in clean})}},
        "measured": {"finished": len(measured), "won": sum(1 for r in measured if r[4]), "lost": sum(1 for r in measured if not r[4]), "pnl": sum(r[6] for r in measured)},
        "strategies": strategies,
        "finished": len(j), "won": wins, "lost": len(j) - wins, "skipped": skipped, "avg_r": sum(r[5] for r in j) / len(j) if j else None,
        "pnl": sum(r[6] for r in j), "too_few": len(j) < TOO_FEW, "needed": TOO_FEW,
        "causes": sorted(({"cause": k, "text": CAUSES[k], "count": n, "loss": k not in ("reached_target", "time_win", "fixed_right", "zone_right")} for k, n in causes.items()), key=lambda x: -x["count"]),
        "lessons": lessons,
        "rules": [{"id": r[0], "tag": r[1], "label": label(r[1]), "status": r[2], "evidence": r[3], "created_at": r[4], "retired_at": r[5]} for r in rules],
        "log": [{"kind": r[0], "message": r[1], "at": r[2]} for r in log],
        "recent": [{"id": r[0], "kind": r[12], "asset": r[1], "direction": r[2], "tf": r[3], "won": r[4], "result_r": r[5], "pnl": r[6], "why": CAUSES[r[7]], "notes": r[8], "at": r[10]} for r in j[:40]],
    }
