"""Market Intelligence Engine API (internal: 127.0.0.1 only; the Node backend proxies it at /intel with login).
Background cycle: crypto bars every 5 min, daily bars every 3 h (free FMP plan: 250 calls/day), then scan + resolve.
Usage: python intel/api.py"""
from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine import data, db, learning, news, progress, scanner, tracking, updown, rootcause   # noqa: E402
from engine.settings import APP_ASSETS, ASSETS, PORT   # noqa: E402

CYCLE_SEC = 5 * 60
DAILY_EVERY_SEC = 3 * 60 * 60
REVALIDATE_EVERY_SEC = 24 * 60 * 60   # re-run the walk-forward test on the growing history once a day
RESEARCH_EVERY_SEC = 7 * 24 * 60 * 60  # the full crypto research, once a week on fresh real data
CANDLE_SETTLE_SEC = 1.5   # the exchange needs a moment to publish a finished candle
HERE = Path(__file__).resolve().parent
RESEARCH_MARK = HERE / "models" / "research.stamp"
DAILY_MARK = HERE / "models" / "daily.stamp"
HEAVY_ONE_AT_A_TIME = threading.Lock()   # the daily and weekly work can fall due together, and together they would not fit in memory

state = {"scan": [], "scanned_at": None, "last_daily": 0.0, "last_backtest": time.time(), "error": None, "quick_at": None, "quick_sec": None}


def cycle() -> None:
    now = time.time()
    data.refresh(providers={"binance"})
    if now - state["last_daily"] >= DAILY_EVERY_SEC:
        data.refresh(providers={"fmp"})
        state["last_daily"] = now
    tracking.resolve_open()
    state["scan"] = scanner.scan_all()
    learning.decide()         # the AI trader may only act on setups decided here
    learning.write_journal()
    learning.refresh_market()
    news.refresh()
    learning.scout_check()
    progress.write()
    state["scanned_at"] = datetime.now(timezone.utc).isoformat()


async def loop() -> None:
    while True:
        try:
            await asyncio.to_thread(cycle)
            state["error"] = None
        except Exception as err:   # keep serving the last good scan
            state["error"] = str(err)
            print("cycle failed:", err, flush=True)
        await asyncio.sleep(CYCLE_SEC)


def quick_cycle() -> None:
    """Fixed Time and InZone readings, every minute: the moment can be any minute, and these trades were tested that way."""
    started = time.time()
    updown.resolve()
    frames = updown.read_market()
    updown.scan(frames)
    updown.scan_inzone(frames)
    learning.decide()
    state["quick_at"], state["quick_sec"] = time.time(), round(time.time() - started, 1)   # the backend watches this and trades at once
    learning.self_check()
    learning.write_journal()
    learning.twelve_hour_check()


def until_next_candle(now: float) -> float:
    """Seconds to wait so the next reading starts just after a 1-minute candle closes, however long the last one took."""
    return 60 - now % 60 + CANDLE_SETTLE_SEC


async def quick_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(quick_cycle)
        except Exception as err:
            print("quick cycle failed:", err, flush=True)
        await asyncio.sleep(until_next_candle(time.time()))


def heavy_job(script: str) -> None:
    """Long, memory-hungry work runs as its own low-priority process, so live scanning and trading never wait for it."""
    flags = subprocess.IDLE_PRIORITY_CLASS | subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    with HEAVY_ONE_AT_A_TIME:
        done = subprocess.run([sys.executable, "-u", str(HERE / script)], cwd=HERE.parent, creationflags=flags, capture_output=True, text=True)
    if done.returncode:
        print(f"{script} failed:", done.stderr[-400:], flush=True)


def daily() -> None:
    # Strategies earn (or lose) "accepted" only through the out-of-sample test, never from live results alone.
    for script in ("run_backtest.py", "run_stress.py", "run_ft_model.py"):
        heavy_job(script)
    learning.learn()    # rules change at most once a day, and only with proof


def due(mark: Path, every: int) -> bool:
    """Remembered on disk, so a restart or a sleeping PC delays this work but never cancels it. The first run ever starts the clock."""
    if not mark.exists():
        mark.write_text(str(time.time()), encoding="utf-8")
        return False
    return time.time() - float(mark.read_text(encoding="utf-8")) >= every


async def daily_loop() -> None:
    while True:
        try:
            if due(DAILY_MARK, REVALIDATE_EVERY_SEC):
                await asyncio.to_thread(daily)
                DAILY_MARK.write_text(str(time.time()), encoding="utf-8")
        except Exception as err:
            print("daily job failed:", err, flush=True)
        await asyncio.sleep(3600)


def research() -> None:
    """Re-runs the research on fresh data and logs what changed. Numbers shown to users update by themselves. A trade type
    passing here is reported; it never promotes itself to proven without the full rule."""
    before = lab_results()
    heavy_job("run_crypto_lab.py")
    heavy_job("run_inzone_lab.py")
    heavy_job("run_stress.py")
    learning.note_research(before, lab_results())
    # the training contest, on fresh data: the live models change only if a new version wins
    picks_before = learning.training_picks()
    heavy_job("run_train_hard.py")
    heavy_job("run_ft_model.py")
    learning.note_training(picks_before, learning.training_picks())
    heavy_job("run_harder_test.py")   # late entry and coins it never saw, on the versions that just won
    heavy_job("run_wide_harder.py")   # InZone on all coins: a group that stops passing stops getting users' money
    signs_before = [s["name"] for s in rootcause.active_signs()]
    heavy_job("run_loss_causes.py")   # why trades fail: a warning sign that passes its fixed rule joins the strategy, one that stops passing leaves it
    learning.note_causes(signs_before)
    RESEARCH_MARK.write_text(str(time.time()), encoding="utf-8")


async def research_loop() -> None:
    """Runs apart from the scan cycle: it takes many minutes, and signals must keep flowing meanwhile."""
    while True:
        try:
            if due(RESEARCH_MARK, RESEARCH_EVERY_SEC):
                await asyncio.to_thread(research)
        except Exception as err:
            print("research failed:", err, flush=True)
        await asyncio.sleep(3600)


def lab_results() -> dict:
    """The last saved crypto research, without loading the research code into the live engine."""
    try:
        return json.loads((HERE.parent / "docs" / "intel" / "crypto.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.ensure_schema()
    learning.ensure()
    news.ensure()
    tasks = [asyncio.create_task(c) for c in (loop(), research_loop(), quick_loop(), daily_loop())]
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="Oliskey Alpha Market Intelligence Engine", lifespan=lifespan)

IDEA_COLS = ("id, asset_id, asset_class, strategy, regime, direction, tf, bar_time, created_at, enter_until, expires_at, "
             "entry, stop, target, probability, ev_per_100, reasons, kind, horizon_hours, status, result_r, exit_price, resolved_at")


def idea_rows(where: str = "true", params: tuple = (), limit: int = 100) -> list[dict]:
    with db.connect() as c:
        cur = c.execute(f"select {IDEA_COLS} from intel.ideas where {where} order by bar_time desc, id desc limit {int(limit)}", params)
        names = [d.name for d in cur.description]
        return [dict(zip(names, r)) for r in cur.fetchall()]


@app.get("/health")
def health():
    return {"ok": True, "markets": len(APP_ASSETS), "scanned_at": state["scanned_at"], "error": state["error"], "quick_at": state["quick_at"], "quick_sec": state["quick_sec"]}


@app.get("/scan")
def scan():
    return {"scanned_at": state["scanned_at"], "markets": state["scan"]}


@app.get("/ideas")
def ideas(limit: int = 100):
    return idea_rows(limit=min(max(limit, 1), 500))


@app.get("/performance")
def performance():
    return tracking.performance()


@app.get("/ai")
def ai():
    return learning.report()


@app.get("/evidence")
def evidence():
    return tracking.evidence()


@app.get("/asset/{asset_id}")
def asset(asset_id: str):
    if asset_id not in ASSETS:
        raise HTTPException(404, "This market is not covered by the engine yet.")
    status = next((m for m in state["scan"] if m["asset"] == asset_id), None)
    return {"status": status, "ideas": idea_rows("asset_id = %s", (asset_id,), 30)}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
