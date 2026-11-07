"""LightGBM layer on top of the rules. For every rule setup it estimates P(win) from the market conditions at the
signal bar, then blends that (calibrated) with the rule's historical hit rate.

No-cheating rules:
- Features use only bars up to the signal bar (computed from indicators.add_all, which has no look-ahead).
- Walk-forward: the model for year Y is trained only on trades that finished before Y starts.
- Calibration: isotonic regression fitted on the last 20% (by time) of each training window, which the model did
  not train on.
- Hyper-parameters and the take-trade margin are fixed in advance and never tuned on results.
"""
from __future__ import annotations

import json

import lightgbm as lgb
import numpy as np
import pandas as pd

from .backtest import PRIOR, expectancy_low, wilson_low
from .settings import INTEL

MODEL_DIR = INTEL / "models"
PARAMS = dict(objective="binary", learning_rate=0.05, num_leaves=15, min_data_in_leaf=50, bagging_fraction=0.8,
              bagging_freq=1, feature_fraction=0.8, lambda_l2=1.0, seed=7, deterministic=True, verbose=-1)
ROUNDS = 200
ML_WEIGHT = 0.7          # final probability = 0.7 * calibrated model + 0.3 * rule history
MARGIN = 0.03            # take a setup only if probability beats break-even by 3 points
MIN_TRAIN = 300          # trades needed before a model is trained at all
MIN_TRADES = 200         # out-of-sample trades needed before the ML layer can be accepted

from .strategies import split_variant

STRATS = ["trend_pullback", "breakout", "mean_reversion"]
REGIMES = ["trend_up", "trend_down", "range", "chaos"]
DIRECTIONAL = ["dist_ema20", "dist_ema50", "dist_ema200", "ema50_slope", "ret_1", "ret_5", "ret_20", "close_loc", "rsi_c"]
FEATURES = DIRECTIONAL + ["adx", "atr_pct", "atr_pct_rank", "bb_width_pct", "vol_ratio", "hour", "weekday",
                          "side", "strategy_id", "reward", "regime_id", "class_id"]


def group_of(asset_class: str) -> str:
    """One model per group; the daily markets are pooled because each has too few trades alone."""
    return asset_class if asset_class.startswith("crypto") else "daily"


def feature_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Direction-free features per bar (df = output of indicators.add_all)."""
    a = df["atr"].replace(0, np.nan)
    c = df["close"]
    f = pd.DataFrame(index=df.index)
    f["dist_ema20"] = (c - df["ema20"]) / a
    f["dist_ema50"] = (c - df["ema50"]) / a
    f["dist_ema200"] = (c - df["ema200"]) / a
    f["ema50_slope"] = (df["ema50"] - df["ema50"].shift(10)) / a
    f["ret_1"] = (c - c.shift(1)) / a
    f["ret_5"] = (c - c.shift(5)) / a
    f["ret_20"] = (c - c.shift(20)) / a
    rng = (df["high"] - df["low"]).replace(0, np.nan)
    f["close_loc"] = (c - df["low"]) / rng - 0.5
    f["rsi_c"] = df["rsi"] - 50
    f["adx"] = df["adx"]
    f["atr_pct"] = df["atr_pct"]
    f["atr_pct_rank"] = df["atr_pct_rank"]
    f["bb_width_pct"] = df["bb_width_pct"]
    f["vol_ratio"] = df["vol_ratio"].where(df["volume"] > 0)
    f["hour"] = df.index.hour
    f["weekday"] = df.index.weekday
    return f


def trade_features(base: pd.Series | pd.DataFrame, direction, strategy, regime, asset_class) -> pd.DataFrame:
    """Turn direction-free features into a trade's features: directional ones point the trade's way."""
    x = base.to_frame().T if isinstance(base, pd.Series) else base.copy()
    d = np.asarray(direction, dtype=float).reshape(-1)
    for col in DIRECTIONAL:
        x[col] = x[col].to_numpy(dtype=float) * d
    x["side"] = d
    names = [split_variant(s) for s in np.atleast_1d(strategy)]   # e.g. breakout_2r -> (breakout, 2.0)
    x["strategy_id"] = [STRATS.index(b) for b, _ in names]
    x["reward"] = [r for _, r in names]
    x["regime_id"] = [REGIMES.index(r) for r in np.atleast_1d(regime)]
    x["class_id"] = [hash_class(c) for c in np.atleast_1d(asset_class)]
    return x[FEATURES].astype(float)


def hash_class(c: str) -> int:
    return ["crypto", "crypto_4h", "currency", "index", "commodity"].index(c)


# ── isotonic calibration (pool adjacent violators) ──
def fit_isotonic(p: np.ndarray, y: np.ndarray, min_weight: float = 1.0) -> dict:
    """`min_weight`: no step may rest on fewer rows than this, so a handful of lucky rows cannot claim a high chance."""
    order = np.argsort(p)
    xs, ys = p[order], y[order].astype(float)
    blocks = [[x, yv, 1.0] for x, yv in zip(xs, ys)]   # [max x, mean y, weight]
    merged: list[list[float]] = []
    for b in blocks:
        merged.append(b)
        while len(merged) > 1 and merged[-2][1] > merged[-1][1]:
            x2, y2, w2 = merged.pop()
            x1, y1, w1 = merged.pop()
            merged.append([x2, (y1 * w1 + y2 * w2) / (w1 + w2), w1 + w2])
    kept: list[list[float]] = []
    for m in merged:
        if kept and kept[-1][2] < min_weight:
            x1, y1, w1 = kept.pop()
            m = [m[0], (y1 * w1 + m[1] * m[2]) / (w1 + m[2]), w1 + m[2]]
        kept.append(m)
    if len(kept) > 1 and kept[-1][2] < min_weight:   # the top step too
        x2, y2, w2 = kept.pop()
        x1, y1, w1 = kept.pop()
        kept.append([x2, (y1 * w1 + y2 * w2) / (w1 + w2), w1 + w2])
    return {"x": [m[0] for m in kept], "y": [m[1] for m in kept]}


def apply_isotonic(cal: dict, p: np.ndarray) -> np.ndarray:
    """Step function: each probability gets the value of the first block whose upper edge it does not exceed."""
    idx = np.searchsorted(np.asarray(cal["x"]), np.asarray(p, dtype=float), side="left")
    return np.asarray(cal["y"])[np.clip(idx, 0, len(cal["y"]) - 1)]


def train(trades: pd.DataFrame) -> tuple[lgb.Booster, dict] | None:
    """Model on the first 80% (by exit time), isotonic calibration on the last 20%."""
    if len(trades) < MIN_TRAIN:
        return None
    t = trades.sort_values("exit_time")
    cut = int(len(t) * 0.8)
    fit, cal = t.iloc[:cut], t.iloc[cut:]
    model = lgb.train(PARAMS, lgb.Dataset(fit[FEATURES], label=fit["win"]), num_boost_round=ROUNDS)
    calib = fit_isotonic(model.predict(cal[FEATURES]), cal["win"].to_numpy())
    return model, calib


def blend(model_p: np.ndarray, rule_p: np.ndarray) -> np.ndarray:
    return ML_WEIGHT * model_p + (1 - ML_WEIGHT) * rule_p


def walk_forward(t: pd.DataFrame) -> pd.DataFrame:
    """Adds `ml_pred` (blended probability known before each trade) for out-of-sample years."""
    t = t.copy()
    t["ml_pred"] = np.nan
    t["group"] = t["asset_class"].map(group_of)
    for g, gt in t.groupby("group"):
        for y in sorted(gt["year"].unique())[1:]:
            cutoff = pd.Timestamp(year=y, month=1, day=1, tz="UTC")
            trained = train(gt[gt["exit_time"] < cutoff])
            if trained is None:
                continue
            model, calib = trained
            idx = gt.index[gt["year"] == y]
            p = apply_isotonic(calib, model.predict(t.loc[idx, FEATURES]))
            t.loc[idx, "ml_pred"] = blend(p, t.loc[idx, "pred"].fillna(0.5).to_numpy())
    return t


def summarize(t: pd.DataFrame) -> pd.DataFrame:
    """Out-of-sample result of trading only the setups the ML layer approves, per asset class."""
    rows = []
    for cls, g in t[t["oos"] & t["ml_pred"].notna()].groupby("asset_class"):
        # Each setup has its own break-even (it depends on its reward-to-risk); report the average of those taken.
        be = (1 + g["cost_r"]) / (1 + g["strategy"].map(lambda s: split_variant(s)[1]))
        take = g[g["ml_pred"] > be + MARGIN]
        breakeven = float(be[take.index].mean()) if len(take) else float(be.mean())
        n, wins = len(take), int(take["win"].sum())
        exp_r = float(take["r"].mean()) if n else 0.0
        low = wilson_low(wins, n)
        rows.append({
            "asset_class": cls, "setups": len(g), "taken": n, "wins": wins, "hit_rate": wins / n if n else 0.0,
            "hit_low": low, "breakeven": breakeven, "expectancy_r": exp_r,
            "all_setups_hit": float(g["win"].mean()), "all_setups_exp": float(g["r"].mean()),
            "accepted": bool(n >= MIN_TRADES and low > breakeven and expectancy_low(take["r"]) > 0),
        })
    return pd.DataFrame(rows)


def importance(model: lgb.Booster, top: int = 8) -> list[tuple[str, float]]:
    gain = model.feature_importance(importance_type="gain")
    total = gain.sum() or 1
    return sorted(((f, g / total) for f, g in zip(FEATURES, gain)), key=lambda x: -x[1])[:top]


def fit_final(t: pd.DataFrame) -> dict[str, list[tuple[str, float]]]:
    """Train each group's live model on all finished trades and save it with its calibration."""
    MODEL_DIR.mkdir(exist_ok=True)
    out = {}
    t = t.copy()
    t["group"] = t["asset_class"].map(group_of)
    for g, gt in t.groupby("group"):
        trained = train(gt)
        if trained is None:
            continue
        model, calib = trained
        model.save_model(str(MODEL_DIR / f"{g}.txt"))
        (MODEL_DIR / f"{g}.calibration.json").write_text(json.dumps(calib), encoding="utf-8")
        out[g] = importance(model)
    return out


_cache: dict[str, tuple] = {}


def predict_live(asset_class: str, feats: pd.DataFrame, rule_p: float) -> float | None:
    """Blended probability for one live setup, or None when no model exists for its group."""
    g = group_of(asset_class)
    path = MODEL_DIR / f"{g}.txt"
    if not path.exists():
        return None
    mtime = path.stat().st_mtime
    if g not in _cache or _cache[g][0] != mtime:
        booster = lgb.Booster(model_file=str(path))
        calib = json.loads((MODEL_DIR / f"{g}.calibration.json").read_text(encoding="utf-8"))
        _cache[g] = (mtime, booster, calib)
    _, booster, calib = _cache[g]
    p = apply_isotonic(calib, booster.predict(feats[FEATURES]))
    return float(blend(p, np.array([rule_p]))[0])


def rule_probability(wins: int, trades: int) -> float:
    return (wins + PRIOR) / (trades + 2 * PRIOR)
