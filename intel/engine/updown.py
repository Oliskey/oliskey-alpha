"""Fixed Time test signals on live crypto: will the price be higher or lower in 60 minutes?

Uses the 60-minute version from run_crypto_lab.py, the same features and the same rule (take it only when the reading beats
break-even by 1%). In testing it won about the break-even rate, so these are test signals, never presented as proven.
Stored in intel.ideas with asset_class 'crypto_ft'. It has no stop or target: a Fixed Time trade simply ends after 60 minutes."""
from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import httpx
import lightgbm as lgb
import numpy as np
import pandas as pd
from psycopg.types.json import Jsonb

import run_crypto_lab as lab
from engine import db
from engine.backtest import wilson_low
from engine.longview import DAY, Holder, HISTORY_DAYS, LONG
from engine.marketview import CORRIDOR, CORRIDOR_ROWS, corridor_view, MARKET, MARKET_ROWS, market_view
from engine.ml import apply_isotonic, fit_isotonic, PARAMS
from engine.rootcause import active_signs, classify, classify_win, hits
from engine.settings import INTEL, ROOT

CLASS, STRATEGY, MINUTES = "crypto_ft", "updown_60m", 60
MODEL, META = INTEL / "models" / "updown_60m.txt", INTEL / "models" / "updown_60m.json"
PAYOUT = lab.PAYOUT_FIXED
BREAKEVEN = 1 / (1 + PAYOUT)
ENTER_MINUTES = 5                # one scan cycle: later than that, it is no longer the tested trade
HISTORY = 1700                   # 1-minute candles needed by the longest feature
ISO_MIN_ROWS = 2000              # each step of a calibrated chance rests on at least this many real results
TRAIN_STEP = 5                # every 5th minute, as in the training contest: the same rows it judged, a fifth of the memory


# ── InZone ──
# The same idea for InZone: will the price finish inside the corridor the server would set? The corridor factor matches
# liveZonePct in the backend. direction is stored as 1 only because the column requires a side; InZone has none.
IZ_CLASS = "crypto_iz"
IZ_MODEL, IZ_META = INTEL / "models" / "inzone.txt", INTEL / "models" / "inzone.json"
IZ_PAYOUT = lab.PAYOUT_INZONE
IZ_BREAKEVEN = 1 / (1 + IZ_PAYOUT)
IZ_Q = 0.511
IZ_MINUTES, IZ_STEP = 60, 15   # 60 minutes by the owner's rule in run_wide_contest.py, every 15th minute as it was judged
IZ_TRAINING = {"days": 4 * 365, "rounds": 300, "lr": 0.03, "rows": 700_000, "blend": 3}
IZ_VERSION = "both, longer"    # the winner of run_market_contest.py
# The other live coins (owner decision 2026-11-06: scan and trade all 17 on demo). They are their own groups with their own test numbers: the original five's results
# must never be shown for them. Fixed Time never trained on them. InZone does since 2026-11-07, and they passed run_wide_harder.py as their own group.
WIDE_COINS = {"ADAUSDT": "ADAUSD", "ATOMUSDT": "ATOMUSD", "AVAXUSDT": "AVAXUSD", "BCHUSDT": "BCHUSD", "DOGEUSDT": "DOGEUSD", "DOTUSDT": "DOTUSD",
              "LINKUSDT": "LINKUSD", "LTCUSDT": "LTCUSD", "NEARUSDT": "NEARUSD", "TRXUSDT": "TRXUSD", "UNIUSDT": "UNIUSD", "XLMUSDT": "XLMUSD"}
ALL_COINS = {**lab.COINS, **WIDE_COINS}
CLASS_WIDE, IZ_WIDE = "crypto_ft_wide", "crypto_iz_wide"
WIDE_ASSETS = set(WIDE_COINS.values())


def _sigma(c: pd.Series) -> pd.Series:
    """The same blend of recent volatility the server uses for the corridor (liveZonePct)."""
    r = np.log(c).diff()
    return np.sqrt(0.5 * r.rolling(15).var() + 0.3 * r.rolling(60).var() + 0.2 * r.rolling(240).var())


def iz_result() -> tuple[int, dict] | None:
    """The version the research found best on average, with its real numbers."""
    try:
        saved = json.loads((ROOT / "docs" / "intel" / "inzone.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    versions = [v for k, v in saved.items() if k.endswith("m") and v.get("trades")]
    if not versions:
        return None
    best = max(versions, key=lambda v: v["avg"])
    return best["minutes"], best


def train_inzone() -> dict:
    """The version that won run_market_contest.py and passed run_wide_harder.py, trained on exactly what it was judged on, built by the same code."""
    import fetch_history       # here, because these import this module
    import run_market_contest as rm
    for sym in ALL_COINS:
        fetch_history.one(sym) # only fetches what is new
    d = rm.build()
    cols = rm.versions([c for c in d.columns if c not in rm.LABELS], "inzone")[IZ_VERSION]["cols"]
    d = d.rename(columns={"y_iz": "y"})[["t", "y", *cols]]
    models, iso = _fit(d, cols, IZ_TRAINING)
    _save(models, IZ_MODEL)
    IZ_META.write_text(json.dumps({"cols": cols, "iso": iso, "minutes": IZ_MINUTES, "models": len(models), "trained_at": datetime.now(timezone.utc).isoformat()}), encoding="utf-8")
    return {"minutes": IZ_MINUTES, "rows": len(d)}


def scan_inzone(frames: dict | None = None) -> int:
    if not IZ_MODEL.exists() or not IZ_META.exists():
        return 0
    frames = read_market() if frames is None else frames
    meta = json.loads(IZ_META.read_text(encoding="utf-8"))
    minutes = meta["minutes"]
    models = _load(IZ_MODEL, meta.get("models", 1))
    with db.connect() as c:
        busy = {r[0] for r in c.execute("select asset_id from intel.ideas where asset_class = any(%s) and status = 'open'", ([IZ_CLASS, IZ_WIDE],)).fetchall()}
    made, readings = 0, []
    signs = active_signs()
    for asset, (df, last) in frames.items():
        if last[[c for c in meta["cols"] if c in LONG + CORRIDOR + MARKET]].isna().any(axis=None):   # no real reading of these for this coin right now: the model must not guess one
            continue
        p = float(apply_isotonic(meta["iso"], _predict(models, last[meta["cols"]]))[0])
        readings.append((asset, p))
        if asset in busy or p <= IZ_BREAKEVEN + lab.MARGIN:
            continue
        entry = float(df["c"].iat[-1])
        sigma = float(_sigma(df["c"]).iloc[-1])
        zone = IZ_Q * sigma * float(np.sqrt(minutes))
        bar = last["t"].iat[0].to_pydatetime() + timedelta(minutes=1)
        reasons = ["the engine read recent real 1-minute prices, volume, and how jumpy the market is",
                   f"it expects the price to finish within about {zone * 100:.3f}% of where it is, in {minutes} minutes"]
        warned = hits(signs, last)        # a warning sign proven by run_loss_causes.py: logged and tracked, but no one trades it
        reasons += [f"It skipped this one: {s['words']}, and tests showed those trades lose money" for s in warned]
        with db.connect() as c:
            c.execute(
                """insert into intel.ideas (asset_id, asset_class, strategy, regime, direction, tf, bar_time, enter_until, expires_at, entry, stop, target,
                     probability, ev_per_100, reasons, kind, horizon_hours)
                   values (%s, %s, %s, 'n/a', 1, '1m', %s, %s, %s, %s, %s, %s, %s, 0, %s, %s, 1) on conflict do nothing""",
                (asset, IZ_WIDE if asset in WIDE_ASSETS else IZ_CLASS, f"inzone_{minutes}m", bar, bar + timedelta(minutes=ENTER_MINUTES), bar + timedelta(minutes=minutes), entry, entry * (1 - zone), entry * (1 + zone), p, Jsonb(reasons), "avoid" if warned else "idea"))
        made += 0 if warned else 1
    _note("inzone", readings, IZ_BREAKEVEN + lab.MARGIN)
    return made


def _frame(df: pd.DataFrame, coin: int, fund: pd.Series, fng: pd.Series) -> pd.DataFrame:
    ts = pd.to_datetime(df["t"], unit="ms", utc=True)
    f = lab.add_context(lab.ta(df, (1, 3, 5, 15, 60, 240, 1440)), ts, fund, fng).astype("float32")
    f["t"], f["coin"] = ts, coin
    return f


def train() -> dict:
    """Trains on all finished real candles. Run daily; the signal only ever uses a model trained on the past."""
    fng = lab.fear_greed()
    frames, btc = [], None
    for i, sym in enumerate(lab.COINS):
        df = _candles_for_training(sym, _picked("fixed_time")["days"])
        f = _frame(df, i, lab.funding(sym), fng)
        if btc is None:
            btc = f.set_index("t")[["r5", "r15"]].rename(columns={"r5": "btc5", "r15": "btc15"})
        f = f.join(btc, on="t")
        c = df["c"]
        f["y"] = np.where(c.shift(-MINUTES) > c, 1, np.where(c.shift(-MINUTES) < c, 0, -1)).astype("int8")
        frames.append(f.iloc[1500:-MINUTES - 10].iloc[::TRAIN_STEP].copy())
        del f
    d = pd.concat(frames, ignore_index=True)
    d = d[d["y"] >= 0]
    cols = [c for c in d.columns if c not in ("t", "y")]
    models, iso = _fit(d, cols, _picked("fixed_time"))
    MODEL.parent.mkdir(exist_ok=True)
    _save(models, MODEL)
    META.write_text(json.dumps({"cols": cols, "iso": iso, "models": len(models), "trained_at": datetime.now(timezone.utc).isoformat()}), encoding="utf-8")
    return {"rows": len(d), "columns": len(cols)}


CANDLE_COLS = ["t", "o", "h", "l", "c", "v", "tb"]
_candles: dict[str, pd.DataFrame] = {}     # what was already downloaded, so each minute only fetches what is new


def _merge_candles(old: pd.DataFrame, new: pd.DataFrame) -> pd.DataFrame | None:
    """The same window one step later, or None if the new candles do not join on and a full download is needed."""
    if new.empty:
        return old
    if new["t"].iat[0] > old["t"].iat[-1] + 60_000:
        return None
    both = pd.concat([old, new], ignore_index=True).drop_duplicates("t", keep="last").sort_values("t", ignore_index=True)
    return both.tail(len(old)).reset_index(drop=True)


def _klines(c: httpx.Client, symbol: str, limit: int, end: int | None = None) -> list:
    params = {"symbol": symbol, "interval": "1m", "limit": limit, **({"endTime": end} if end else {})}
    return c.get("https://api.binance.com/api/v3/klines", params=params).raise_for_status().json()


def _finished(data: list) -> pd.DataFrame:
    now = time.time() * 1000
    rows = [(k[0], float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5]), float(k[9])) for k in data if k[6] < now]
    return pd.DataFrame(rows, columns=CANDLE_COLS).astype({"t": "int64"})


def _recent(symbol: str) -> pd.DataFrame:
    """The latest finished 1-minute candles from Binance. Candles that have finished never change, so after the first download only the newest are fetched."""
    with httpx.Client(timeout=15) as c:
        old = _candles.get(symbol)
        if old is not None:
            joined = _merge_candles(old, _finished(_klines(c, symbol, 5)))
            if joined is not None:
                _candles[symbol] = joined
                return joined
        data, end = [], None
        for _ in range(2):
            part = _klines(c, symbol, 1000, end)
            data = part + data
            end = part[0][0] - 1
    df = _finished(data).drop_duplicates("t").sort_values("t", ignore_index=True)
    _candles[symbol] = df
    return df


# These change every 8 hours and once a day. The bar only ever uses a published value, so reading them less often changes no reading that matters.
FUNDING_EVERY_SEC, FEAR_EVERY_SEC = 600, 3600
_slow: dict[str, tuple[float, pd.Series]] = {}


def _kept(key: str, every: int, read) -> pd.Series:
    held = _slow.get(key)
    if held and time.time() - held[0] < every:
        return held[1]
    value = read()
    _slow[key] = (time.time(), value)
    return value


def _picked(kind: str) -> dict:
    """The version that won the training contest (run_train_hard.py), or the original settings."""
    try:
        return json.loads((INTEL / "models" / "training.json").read_text(encoding="utf-8"))["picks"][kind]
    except (OSError, ValueError, KeyError):
        return {"days": 365, "rounds": 150, "lr": None, "rows": 300_000}


def _candles_for_training(symbol: str, days: int) -> pd.DataFrame:
    """The longer history when it has been downloaded, brought up to date."""
    recent = lab.candles(symbol)
    path = lab.CACHE / "long" / f"{symbol}.npz"
    if not path.exists():
        return recent
    z = np.load(path)
    old = pd.DataFrame({k: z[k] for k in z.files})
    full = pd.concat([old, recent], ignore_index=True).drop_duplicates("t").sort_values("t", ignore_index=True)
    return full.tail((days + 2) * 1440 + HISTORY).reset_index(drop=True)   # only what the chosen version trains on


def _fit(d: pd.DataFrame, cols: list[str], v: dict) -> tuple[list[lgb.Booster], dict]:
    """Trains the version that won the contest, exactly as it was judged: a blend stays a blend, so live readings match the test."""
    d = d[d["t"] >= d["t"].max() - pd.Timedelta(days=v["days"])]
    cut = d["t"].quantile(0.85)
    fit, cal = d[d["t"] < cut - pd.Timedelta(days=1)], d[d["t"] >= cut]
    models = []
    for seed in range(7, 7 + v.get("blend", 1)):
        s = fit.sample(min(len(fit), v["rows"]), random_state=seed)
        params = {**PARAMS, "verbose": -1, "seed": seed, **({"learning_rate": v["lr"]} if v.get("lr") else {})}
        models.append(lgb.train(params, lgb.Dataset(s[cols], s["y"]), num_boost_round=v["rounds"]))
    return models, fit_isotonic(_predict(models, cal[cols]), cal["y"].to_numpy(), ISO_MIN_ROWS)


def _predict(models: list[lgb.Booster], x: pd.DataFrame) -> np.ndarray:
    return np.mean([m.predict(x) for m in models], axis=0)


def _save(models: list[lgb.Booster], path) -> None:
    """Extra blend members first, so a reading made during the save still finds complete files."""
    for i, m in reversed(list(enumerate(models))):
        m.save_model(str(path) if i == 0 else f"{path}.{i}")


def _load(path, count: int) -> list[lgb.Booster]:
    return [lgb.Booster(model_file=str(path) if i == 0 else f"{path}.{i}") for i in range(count)]


# What it last read, per trade type, so the app can show it listening.
listening: dict[str, dict] = {}


def _fetch(sym: str) -> tuple[str, pd.DataFrame, pd.Series] | None:
    try:
        return sym, _recent(sym), _kept(f"funding:{sym}", FUNDING_EVERY_SEC, lambda: lab.funding(sym))
    except httpx.HTTPError:
        return None


def _stored(symbol: str, cols: tuple[str, ...], rows: int) -> pd.DataFrame:
    """The newest rows of the 4-year record that intel/fetch_history.py keeps."""
    with np.load(lab.CACHE / "all" / f"{symbol}.npz") as z:
        return pd.DataFrame({k: z[k] for k in cols}).tail(rows).reset_index(drop=True)


_holders: dict[str, Holder] = {}


def corridor_now(h: Holder) -> dict[str, float]:
    """How the corridor has been holding on this coin, at its newest minute."""
    m = h.recent(CORRIDOR_ROWS)
    return {k: float(v) for k, v in corridor_view(m["c"], m["h"], m["l"], _sigma(m["c"]), IZ_Q).iloc[-1].items()}


def market_now(candles: dict[str, pd.DataFrame]) -> dict[str, dict[str, float]]:
    """What all the coins that answered are doing together, per coin at that coin's newest minute."""
    table = pd.DataFrame({s: df.tail(MARKET_ROWS).set_index("t")["c"] for s, df in candles.items()}).sort_index()
    view = market_view(table)
    moved = np.log(table).diff(IZ_MINUTES)
    out = {}
    for s, df in candles.items():
        t = int(df["t"].iat[-1])
        out[s] = {k: float(v.loc[t]) for k, v in view.items()}
        out[s]["own_vs_mkt_60"] = float(moved[s].loc[t]) - out[s]["mkt_ret_60"]
    return out


def _long_reading(symbol: str, df: pd.DataFrame) -> dict[str, float] | None:
    """The long view for a coin's newest minute. None if it cannot be read for real, so that coin waits."""
    try:
        h = _holders.get(symbol)
        if h is None:
            h = _holders[symbol] = Holder(_stored(symbol, ("t", "h", "l", "c"), HISTORY_DAYS * DAY + 1))
        first = int(df["t"].iat[0])
        with httpx.Client(timeout=15) as c:
            while h.last + 60_000 < first:         # the engine was off: the missing minutes come first, in order
                part = _finished(c.get("https://api.binance.com/api/v3/klines", params={"symbol": symbol, "interval": "1m", "limit": 1000, "startTime": h.last + 60_000}).raise_for_status().json())
                if part.empty:
                    return None
                h.add(part)
        h.add(df)
        return {**h.reading(), **corridor_now(h)} if h.last == int(df["t"].iat[-1]) else None
    except (httpx.HTTPError, OSError, KeyError, ValueError) as err:
        print(f"long view {symbol}: {type(err).__name__}", flush=True)
        return None


def read_market() -> dict:
    """The latest real candles and features for every live coin, read once and shared by both models. Coins that did not answer are
    left out. Fixed Time never trained on the other 12 coins, so they get no coin number, exactly as they were tested (run_harder_test.py)."""
    fng = _kept("fear", FEAR_EVERY_SEC, lab.fear_greed)
    with ThreadPoolExecutor(6) as pool:   # all 17 inside the minute
        fetched = [x for x in pool.map(_fetch, ALL_COINS) if x]
    trained = list(lab.COINS)
    frames, btc = {}, None
    together = market_now({sym: df for sym, df, _ in fetched if len(df) >= HISTORY})
    for sym, df, fund in fetched:
        asset = ALL_COINS[sym]
        if len(df) < HISTORY:
            continue
        f = _frame(df, trained.index(sym) if sym in trained else 0, fund, fng)
        if sym not in trained:
            f["coin"] = np.nan
        if sym == "BTCUSDT":
            btc = f.set_index("t")[["r5", "r15"]].rename(columns={"r5": "btc5", "r15": "btc15"})
        if btc is None:          # no real Bitcoin reading to go with it: another coin must not stand in
            continue
        f = f.join(btc, on="t")
        f[["btc5", "btc15"]] = f[["btc5", "btc15"]].ffill()   # a coin read just after a new minute began has no Bitcoin value for it yet
        extra = {**(_long_reading(sym, df) or {}), **together[sym]}
        last = f.iloc[[-1]].assign(**{k: np.float32(extra.get(k, np.nan)) for k in LONG + CORRIDOR + MARKET})
        if datetime.now(timezone.utc) - last["t"].iat[0].to_pydatetime() <= timedelta(minutes=3):
            frames[asset] = (df, last)
    return frames


def _note(kind: str, readings: list[tuple[str, float]], needed: float) -> None:
    if not readings:
        return
    asset, best = max(readings, key=lambda r: r[1])
    listening[kind] = {"at": datetime.now(timezone.utc).isoformat(), "markets": len(readings), "asset": asset, "reading": best, "needed": needed}


def scan(frames: dict | None = None) -> int:
    """Publishes a test signal when the reading clears the rule. One open signal per coin."""
    if not MODEL.exists() or not META.exists():
        return 0
    frames = read_market() if frames is None else frames
    meta = json.loads(META.read_text(encoding="utf-8"))
    models = _load(MODEL, meta.get("models", 1))
    with db.connect() as c:
        busy = {r[0] for r in c.execute("select asset_id from intel.ideas where asset_class = any(%s) and status = 'open'", ([CLASS, CLASS_WIDE],)).fetchall()}
    made, readings = 0, []
    for asset, (df, last) in frames.items():
        p = float(apply_isotonic(meta["iso"], _predict(models, last[meta["cols"]]))[0])
        direction = 1 if p > 0.5 else -1
        conf = p if direction > 0 else 1 - p
        readings.append((asset, conf))
        if asset in busy or conf <= BREAKEVEN + lab.MARGIN:
            continue
        bar = last["t"].iat[0].to_pydatetime() + timedelta(minutes=1)
        entry = float(df["c"].iat[-1])
        reasons = ["the engine read recent real 1-minute prices, volume, and buyer and seller pressure",
                   f"it expects the price to be {'higher' if direction > 0 else 'lower'} in 60 minutes"]
        with db.connect() as c:
            c.execute(
                """insert into intel.ideas (asset_id, asset_class, strategy, regime, direction, tf, bar_time, enter_until, expires_at, entry, stop, target,
                     probability, ev_per_100, reasons, kind, horizon_hours)
                   values (%s, %s, %s, 'n/a', %s, '1m', %s, %s, %s, %s, %s, %s, %s, 0, %s, 'idea', 1) on conflict do nothing""",
                (asset, CLASS_WIDE if asset in WIDE_ASSETS else CLASS, STRATEGY, direction, bar, bar + timedelta(minutes=ENTER_MINUTES), bar + timedelta(minutes=MINUTES), entry, entry, entry, conf, Jsonb(reasons)))
        made += 1
    _note("fixed_time", readings, BREAKEVEN + lab.MARGIN)
    return made


def resolve() -> int:
    """Each finished signal, from the real close 60 minutes later: +0.8 on a win, -1 on a loss, 0 if level."""
    with db.connect() as c:
        rows = c.execute("select id, asset_id, direction, entry, expires_at, asset_class, stop, target from intel.ideas where asset_class = any(%s) and status = 'open' and expires_at <= now()", ([CLASS, IZ_CLASS, CLASS_WIDE, IZ_WIDE],)).fetchall()
    symbols = {v: k for k, v in ALL_COINS.items()}
    done = 0
    for iid, asset, direction, entry, ends, cls, low, high in rows:
        try:
            start = int(ends.timestamp() * 1000) - 60_000
            data = httpx.get("https://api.binance.com/api/v3/klines", params={"symbol": symbols[asset], "interval": "1m", "startTime": start, "limit": 1}, timeout=15).raise_for_status().json()
        except httpx.HTTPError:
            continue
        if not data:
            continue
        close = float(data[0][4])
        move = direction * (close - entry)
        if cls in (IZ_CLASS, IZ_WIDE):
            status, r = ("won", IZ_PAYOUT) if low <= close <= high else ("lost", -1.0)
        else:
            status, r = ("won", PAYOUT) if move > 0 else ("lost", -1.0) if move < 0 else ("expired", 0.0)
        with db.connect() as c:
            c.execute("update intel.ideas set status = %s, result_r = %s, exit_price = %s, resolved_at = %s where id = %s and status = 'open'", (status, r, close, ends, iid))
        done += 1
    return done


def zone_cause(asset: str, bar_time: datetime, entry: float, high: float, won: bool = False) -> str | None:
    """Why an InZone signal ended as it did, from the candles already held. None if they no longer cover it."""
    symbol = {v: k for k, v in ALL_COINS.items()}.get(asset)
    start = int(bar_time.timestamp() * 1000) - 60_000
    end = start + IZ_MINUTES * 60_000
    held = _candles.get(symbol) if symbol else None
    if held is None:
        return None
    closes = held[(held["t"] >= start) & (held["t"] <= end)]["c"].to_numpy(dtype="float64")
    if len(closes) != IZ_MINUTES + 1:
        return None
    if won:
        return classify_win(closes, high / entry - 1)
    moves = []
    for other in _candles.values():
        a, b = other[other["t"] == start]["c"], other[other["t"] == end]["c"]
        if len(a) and len(b):
            moves.append(float(np.log(b.iat[0] / a.iat[0])))
    return classify(closes, high / entry - 1, float(np.mean(moves)))


def money_proof(m: dict | None) -> bool:
    """May a user's money go here? RULE, fixed 2026-11-07 before any change was made, not to be loosened: on the model actually trading,
    the corrected lower bound is above zero, every test period earns, and no one period brings more than 60% of the profit."""
    if not m or not m.get("periods") or m.get("low") is None:
        return False
    periods = m["periods"]
    return m["low"] > 0 and min(periods) > 0 and max(periods) <= 0.6 * sum(periods)


def _harder(kind: str, part: str) -> dict | None:
    """What the harder test measured on the model that is actually trading."""
    try:
        return json.loads((ROOT / "docs" / "intel" / "harder.json").read_text(encoding="utf-8"))["results"][kind][part]
    except (OSError, ValueError, KeyError):
        return None


def _deployed(g: dict, kind: str) -> dict:
    """The group's numbers from the model trading now, not from the older research model. Without them no user's money goes there."""
    m, late = _harder(kind, "as_tested"), _harder(kind, "late")
    if not m:
        return {**g, "money_ok": False}
    trades, wins = round(m["trades"]), round(m["trades"] * m["won"])
    return {**g, "trades": trades, "wins": wins, "low": wilson_low(wins, trades), "high": wilson_low(wins, trades, -1.96), "avg_r": m["avg"], "corrected_low": m["low"],
            "money_ok": money_proof(m) and money_proof(late)}


def long_model_live() -> bool:
    """Whether the InZone model trading now is the one that passed run_wide_harder.py. Until it is, those numbers must not be shown or used for it."""
    try:
        return set(LONG) <= set(json.loads(IZ_META.read_text(encoding="utf-8"))["cols"])
    except (OSError, ValueError, KeyError):
        return False


def _last_test(g: dict, group: str) -> dict:
    """The group's numbers from run_wide_harder.py. Without a pass on the model trading now, no user's money goes there."""
    try:
        t = json.loads((ROOT / "docs" / "intel" / "wide_harder.json").read_text(encoding="utf-8"))["results"]["groups"][group]
    except (OSError, ValueError, KeyError):
        return {**g, "money_ok": False}
    m = t["as_tested"]
    trades, wins = round(m["trades"]), round(m["trades"] * m["won"])
    return {**g, "trades": trades, "wins": wins, "low": wilson_low(wins, trades), "high": wilson_low(wins, trades, -1.96), "avg_r": m["avg"], "corrected_low": m["low"], "money_ok": t["passed"]}


def iz_evidence_group() -> dict | None:
    picked = iz_result()
    if not picked:
        return None
    minutes, g = picked
    if long_model_live():
        return _last_test({"status": "experimental" if g.get("passed") else "test", "label": f"Crypto, InZone {IZ_MINUTES} minutes", "breakeven": g["breakeven"], "failed": g["failed"]}, "usual")
    return _deployed({"status": "experimental" if g.get("passed") else "test", "label": f"Crypto, InZone {minutes} minutes", "trades": g["trades"], "wins": g["wins"], "low": g["low"], "high": g["high"],
                      "breakeven": g["breakeven"], "avg_r": g["avg"], "corrected_low": g["corrected_low"], "failed": g["failed"]}, "inzone")


def wide_evidence_group(kind: str) -> dict | None:
    """What the tests measured on the other 12 coins. Fixed Time never trained on them, and the harder test covers only 5 of them, so it stays a test signal with no users' money."""
    if kind == "inzone" and long_model_live():
        return _last_test({"status": "test", "label": f"Crypto, InZone {IZ_MINUTES} minutes, 12 more coins", "breakeven": IZ_BREAKEVEN, "failed": []}, "others")
    try:
        s = json.loads((ROOT / "docs" / "intel" / "harder.json").read_text(encoding="utf-8"))["results"][kind]["unseen"]
    except (OSError, ValueError, KeyError):
        return None
    trades, wins = round(s["trades"]), round(s["trades"] * s["won"])
    if not trades:
        return None
    return {"status": "test", "label": f"Crypto, {'Fixed Time' if kind == 'fixed_time' else 'InZone'} 60 minutes, coins outside its training", "trades": trades, "wins": wins,
            "low": wilson_low(wins, trades), "high": wilson_low(wins, trades, -1.96), "breakeven": BREAKEVEN if kind == "fixed_time" else IZ_BREAKEVEN, "avg_r": s["avg"],
            "corrected_low": s["low"], "failed": ["Has not been through the full rule", "The model did not train on these coins"],
            "money_ok": False}   # the harder test covers only 5 of these 12 coins, so its result cannot speak for the group


def evidence_group() -> dict | None:
    """The real 60-minute test numbers, in the shape the app shows every group."""
    try:
        g = json.loads((ROOT / "docs" / "intel" / "crypto.json").read_text(encoding="utf-8"))["fixed_time"]["60m"]
    except (OSError, ValueError, KeyError):
        return None
    if not g.get("trades"):
        return None
    return _deployed({"status": "test", "label": "Crypto, Fixed Time 60 minutes", "trades": g["trades"], "wins": g["wins"], "low": g["low"], "high": g["high"],
                      "breakeven": g["breakeven"], "avg_r": g["avg"], "corrected_low": g["corrected_low"], "failed": g["failed"]}, "fixed_time")
