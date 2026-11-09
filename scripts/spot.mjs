// AI Spot helper. Runs the Python side with the same Python the backend uses (Windows venv, Railway, or PATH).
//   npm run spot:test    engine self-tests (no network)
//   npm run spot:fetch   download BTC/ETH spot history from Binance (falls back to the static-klines mirror)
//   npm run spot:lab     test every strategy and rewrite docs/intel/SPOT_RESULTS.md + spot_registry.json
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const venv = path.join(process.env.LOCALAPPDATA || '', 'oliskey-alpha', 'intel-venv', 'Scripts', 'python.exe');
const PYTHON = process.env.INTEL_PYTHON || (existsSync(venv) ? venv : (process.platform === 'win32' ? 'python' : 'python3'));
const SCRIPTS = { test: 'intel/selftest_spot.py', fetch: 'intel/fetch_spot_history.py', lab: 'intel/run_spot_lab.py' };

const task = process.argv[2];
if (!SCRIPTS[task]) {
  console.error(`usage: node scripts/spot.mjs ${Object.keys(SCRIPTS).join('|')}`);
  process.exit(2);
}
const r = spawnSync(PYTHON, [path.join(ROOT, SCRIPTS[task]), ...process.argv.slice(3)], { stdio: 'inherit', cwd: ROOT, windowsHide: true });
if (r.error) console.error(`could not start Python (${PYTHON}): ${r.error.message}`);
process.exit(r.status ?? 1);
