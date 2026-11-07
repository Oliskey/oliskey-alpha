"""Runs one learning pass now (it also runs by itself once a day): writes the journal, then looks for rules to adopt or retire.
Usage: python intel/run_learning.py"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine import learning  # noqa: E402

learning.ensure()
print("journal entries added:", learning.write_journal())
print("setups decided:", learning.decide())
print("learning:", json.dumps(learning.learn()))
r = learning.report()
print(f"finished {r['finished']}: won {r['won']}, lost {r['lost']}, skipped {r['skipped']}, pnl {r['pnl']:.2f}")
for c in r["causes"]:
    print(f"  {c['count']:>3}  {c['text']}")
for x in r["lessons"]:
    print(f"  {x['trades']:>3} trades, {x['won']} won, {x['avg_r']:+.2f}R  {x['label']}")
for x in r["log"][:10]:
    print("  log:", x["message"])
for s in r["strategies"]:
    print(f"  {s['label']} {s['tf']}: {s['won']} of {s['trades']} won, {s['pnl']:+.2f}, {s['avg_r']:+.2f}R")
