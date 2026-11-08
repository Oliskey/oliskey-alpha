// Two copies of the server, one database: only one may lead, and the other takes over when it stops. Uses the local test database only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const backend = path.resolve(import.meta.dirname, '..');
const line = readFileSync(path.join(backend, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
const url = line.slice('DATABASE_URL='.length).replace(/^['"]|['"]$/g, '').replace(/\/oliskey_alpha(\?|$)/, '/oliskey_alpha_test$1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function copy(port) {
  const out = { text: '', proc: null };
  out.proc = spawn(process.execPath, ['src/server.js'], {
    cwd: backend, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATABASE_URL: url, INTEL_DISABLED: '1', LEADER_RETRY_MS: '1000', LOCALAPPDATA: path.join(backend, '.data', `leader-test-${port}`) },
  });
  out.proc.stdout.on('data', (d) => { out.text += d; });
  out.proc.stderr.on('data', (d) => { out.text += d; });
  return out;
}
const leads = (c) => c.text.includes('This copy is the leader');
const up = async (port) => { for (let i = 0; i < 240; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return true; } catch {} await sleep(500); } return false; };

test('two copies: exactly one leads, and the other takes over when it stops', { timeout: 240_000 }, async () => {
  if (!url.includes('/oliskey_alpha_test')) throw new Error('not the test database');
  const a = copy(3394), b = copy(3395);
  try {
    const both = (await up(3394)) && (await up(3395));
    assert.ok(both, `both copies serve the website and API
A: ${a.text.slice(-400)}
B: ${b.text.slice(-400)}`);
    await sleep(4000);
    assert.equal([a, b].filter(leads).length, 1, `exactly one leader\nA: ${a.text.slice(-300)}\nB: ${b.text.slice(-300)}`);
    const [first, second] = leads(a) ? [a, b] : [b, a];
    first.proc.kill();
    for (let i = 0; i < 20 && !leads(second); i++) await sleep(500);
    assert.ok(leads(second), 'the other copy took over');
  } finally {
    a.proc.kill(); b.proc.kill();
  }
});
