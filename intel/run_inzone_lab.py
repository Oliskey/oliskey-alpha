"""InZone research, report only: with the fair corridor (0.511 x blended volatility x sqrt(duration), see corridor below), can real market data
tell when the price will finish inside it often enough to beat the +110% payout (47.62%)?

Walk-forward, same features and the same pass rule as run_crypto_lab.py, fixed before any result is seen.
Writes docs/intel/inzone.json. Usage: python intel/run_inzone_lab.py"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_crypto_lab as lab                # noqa: E402
from engine.ml import PARAMS                # noqa: E402
from engine.settings import ROOT            # noqa: E402

MINUTES = [15, 60]
Q = 0.511                                   # the corridor factor used by the server (liveZonePct)
BE = 1 / (1 + lab.PAYOUT_INZONE)


def corridor_sigma(c: pd.Series) -> pd.Series:
    """The server's blend of recent volatility, per minute."""
    r = np.log(c).diff()
    return np.sqrt(0.5 * r.rolling(15).var() + 0.3 * r.rolling(60).var() + 0.2 * r.rolling(240).var())


def main() -> None:
    fng = lab.fear_greed()
    frames, btc = [], None
    for i, sym in enumerate(lab.COINS):
        df = lab.candles(sym)
        ts = pd.to_datetime(df["t"], unit="ms", utc=True)
        f = lab.add_context(lab.ta(df, (1, 3, 5, 15, 60, 240, 1440)), ts, lab.funding(sym), fng).astype("float32")
        f["t"], f["coin"] = ts, i
        if btc is None:
            btc = f.set_index("t")[["r5", "r15"]].rename(columns={"r5": "btc5", "r15": "btc15"})
        f = f.join(btc, on="t")
        c = df["c"]
        sigma = corridor_sigma(c)
        for h in MINUTES:
            zone = Q * sigma * np.sqrt(h)
            f[f"y{h}"] = (np.log(c.shift(-h) / c).abs() <= zone).astype("int8")
            f[f"late{h}"] = (np.log(c.shift(-h - 1) / c.shift(-1)).abs() <= zone).astype("int8")
        frames.append(f.iloc[1500:-70])
        print(sym, len(f), flush=True)
    d = pd.concat(frames, ignore_index=True)
    cols = [c for c in d.columns if c != "t" and not c.startswith(("y", "late"))]
    d["month"] = d["t"].dt.strftime("%Y-%m")
    months = sorted(d["month"].unique())
    out = {}
    for h in MINUTES:
        parts = []
        for m in months[3:]:
            test = d[d["month"] == m]
            parts.append(test[["t", "coin", f"y{h}", f"late{h}"]].assign(p=lab.fit_predict(d[d["month"] < m], test, cols, f"y{h}")))
            print(f"  {h}m {m}", flush=True)
        o = pd.concat(parts)
        o["win"] = o[f"y{h}"] == 1
        o["r"] = np.where(o["win"], lab.PAYOUT_INZONE, -1.0)
        o["r_late"] = np.where(o[f"late{h}"] == 1, lab.PAYOUT_INZONE, -1.0)
        take = lab.one_at_a_time(o[o["p"] > BE + lab.MARGIN], pd.Timedelta(minutes=h))
        out[f"{h}m"] = {**lab.verdict(take, float(take["r_late"].mean()) if len(take) else None, "entered one candle late", BE),
                        "minutes": h, "every_candle_won": float(o["win"].mean()), "by_confidence": [
                            {"from": a, "to": b, "rows": int(((o["p"] > a) & (o["p"] <= b)).sum()), "won": float(o.loc[(o["p"] > a) & (o["p"] <= b), "win"].mean())}
                            for a, b in ((0.3, 0.4), (0.4, 0.45), (0.45, 0.5), (0.5, 0.55), (0.55, 0.6), (0.6, 1.01)) if ((o["p"] > a) & (o["p"] <= b)).any()]}
        r = out[f"{h}m"]
        print(f"{h}m: {r['trades']} trades, won {r.get('win_rate', 0):.2%}, needs {BE:.2%}, avg {r.get('avg', 0):+.3f}, corrected low {r.get('corrected_low', 0):+.3f}, late {r.get('harder') or 0:+.3f}, months {r.get('months_positive')}, passed {r['passed']}", flush=True)
    (ROOT / "docs" / "intel" / "inzone.json").write_text(json.dumps({"generated_at": datetime.now(timezone.utc).isoformat(), **out}, indent=1), encoding="utf-8")
    print("wrote docs/intel/inzone.json", flush=True)


if __name__ == "__main__":
    main()
