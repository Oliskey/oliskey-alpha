"""Settings: keys from the root .env.local (never logged), database URL from backend/.env, universe from YAML."""
from __future__ import annotations

import os
from pathlib import Path

import yaml
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
INTEL = ROOT / "intel"

_env = {**dotenv_values(ROOT / "backend" / ".env"), **dotenv_values(ROOT / ".env.local"), **os.environ}

FMP_API_KEY = _env.get("FMP_API_KEY", "")
DATABASE_URL = _env.get("DATABASE_URL", "")
PORT = int(_env.get("INTEL_PORT", "3312"))

UNIVERSE = yaml.safe_load((INTEL / "config" / "universe.yaml").read_text(encoding="utf-8"))
CLASSES: dict[str, dict] = UNIVERSE["classes"]
ASSETS: dict[str, dict] = UNIVERSE["assets"]
# Markets the app shows and the scanner scans; train_only markets only feed backtests and models.
APP_ASSETS: list[str] = [a for a, c in ASSETS.items() if not c.get("train_only")]


def asset_cfg(asset_id: str, cls: str | None = None) -> dict:
    """Asset entry merged with a class's settings (provider, timeframe, horizon, costs).
    `cls` picks an extra test variant (e.g. crypto_4h); by default the asset's own class."""
    a = ASSETS[asset_id]
    key = cls or a["class"]
    return {**CLASSES[key], **a, "class": key, "id": asset_id}


def variants(asset_id: str) -> list[str]:
    """Every class an asset is tested and scanned under: its own class plus variants that apply to it."""
    base = ASSETS[asset_id]["class"]
    return [base] + [k for k, c in CLASSES.items() if c.get("applies_to") == base]
