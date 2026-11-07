"""Trains the Fixed Time and InZone models on real candles (it also retrains by itself once a day). Usage: python intel/run_ft_model.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine import updown  # noqa: E402

print(updown.train())
print(updown.train_inzone())
print("signals published now:", updown.scan(), updown.scan_inzone())
