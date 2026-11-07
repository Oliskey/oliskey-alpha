"""Why an InZone trade failed, measured from real prices, and which warning signs could be seen before entry.

classify() names the cause of one loss, after the fact. The cause itself cannot be avoided once it has happened: only a warning sign that was visible before entry can be.
run_loss_causes.py tests the signs in SIGNS each week. active_signs() returns those that passed its fixed rule, and the live scan then logs those setups as "avoid" instead of trading them.
A sign that stops passing stops being used at the next weekly run."""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from .settings import ROOT

RESULT = ROOT / "docs" / "intel" / "causes.json"
Q = 0.511            # the corridor factor (engine.updown.IZ_Q), repeated here so this file needs nothing heavy
MINUTES = 60
NEAR = 1.15          # finishing within 15% of the corridor's edge counts as just outside
JUMPY = 1.5          # moving this many times more than the corridor expected counts as jumpier than expected

CAUSES = {
    "zone_just_outside": "InZone: it finished just outside the corridor, so a small late move decided it.",
    "zone_market_moved": "InZone: the whole market moved as far as the corridor, taking this coin with it.",
    "zone_sudden_jump": "InZone: a sudden jump inside 5 minutes crossed the corridor.",
    "zone_jumpier": "InZone: the coin moved far more than the recent prices that set the corridor had shown.",
    "zone_steady_drift": "InZone: a steady move in one direction carried it out, with no jump and no unusual movement.",
    "zone_late_price": "InZone: the signal itself won, but the trade opened later at a different price and lost.",
    "zone_stayed_inside": "InZone: the price stayed inside the corridor for the whole trade.",
    "zone_came_back": "InZone: the price left the corridor during the trade, then came back before the end.",
}
WINS = ("zone_stayed_inside", "zone_came_back")

# (name, plain words, input, high or low): the top or bottom fifth of that input. "abs:" means its size in either direction. All known before entry.
SIGNS = (
    ("market_jumpy", "the whole market has just turned jumpier than usual", "mkt_jumpy", "high"),
    ("market_split", "coins are moving very differently from each other", "mkt_spread_60", "high"),
    ("market_running", "the whole market has just made a big move", "abs:mkt_ret_60", "high"),
    ("coin_alone", "this coin has just moved far from the rest of the market", "abs:own_vs_mkt_60", "high"),
    ("corridor_failing_day", "the corridor has often failed on this coin in the last 24 hours", "hit_24h", "low"),
    ("corridor_failing_week", "the corridor has often failed on this coin in the last 7 days", "hit_7d", "low"),
    ("corridor_narrow_day", "the corridor is narrow compared with today's range", "zone_vs_day", "low"),
    ("corridor_narrow", "the corridor is unusually narrow", "zone_width", "low"),
    ("week_jumpy", "this coin has been jumpy all week", "vol_7d", "high"),
    ("day_running", "this coin has made a big move in the last day", "abs:ret_1d", "high"),
    ("far_from_average", "the price is far from its 200-day average", "abs:dist_200d", "high"),
    ("range_edge", "the price is at the top of its 30-day range", "range_30d", "high"),
)


def classify(closes: np.ndarray, zone: float, market_move: float) -> str:
    """One finished loss. closes: from entry to the end of the trade, each minute. zone: half-width of the corridor, as a fraction. market_move: the average coin's move in that time, as a log return."""
    log = np.log(closes)
    final = float(log[-1] - log[0])
    if abs(final) <= NEAR * zone:
        return "zone_just_outside"
    if abs(market_move) >= zone and market_move * final > 0:
        return "zone_market_moved"
    if len(log) > 5 and float(np.abs(log[5:] - log[:-5]).max()) >= zone:
        return "zone_sudden_jump"
    if float(np.diff(log).std()) >= JUMPY * zone / (Q * np.sqrt(MINUTES)):
        return "zone_jumpier"
    return "zone_steady_drift"


def classify_win(closes: np.ndarray, zone: float) -> str:
    """One finished win: a calm trade, or one that was nearly lost."""
    log = np.log(closes)
    return "zone_stayed_inside" if float(np.abs(log - log[0]).max()) <= zone else "zone_came_back"


def sign_value(row, column: str) -> float:
    """row: anything that gives an input by name."""
    return abs(float(row[column[4:]])) if column.startswith("abs:") else float(row[column])


def active_signs() -> list[dict]:
    """The warning signs that passed the fixed rule at the last weekly run. A missing or broken file means none."""
    try:
        return list(json.loads(RESULT.read_text(encoding="utf-8"))["active"])
    except (OSError, ValueError, KeyError):
        return []


def hits(signs: list[dict], last: pd.DataFrame) -> list[dict]:
    """Which active signs show on this one-row reading. A reading that cannot be made never counts as a hit."""
    found = []
    for s in signs:
        value = sign_value(last.iloc[0], s["column"])
        if not np.isnan(value) and (value >= s["limit"] if s["side"] == "high" else value <= s["limit"]):
            found.append(s)
    return found
