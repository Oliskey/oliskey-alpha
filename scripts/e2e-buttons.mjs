// "Press every button" check (audit phase 3/4) on the web build, phone size, headless Edge via CDP.
// For each screen it presses every focusable element (max 25 per screen) on a fresh load and records whether
// anything visibly changed (URL, text, or element count). Also flags targets under 44x44 px and missing labels.
//   node scripts/e2e-buttons.mjs  (run from backend/ so `ws` resolves; server on :3311)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const APP = process.env.API_URL || 'http://localhost:3311';
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9341;
const SKIP = /^(Log out)$/;   // would end the session for the rest of the run
const SCREENS = [['Home', '/'], ['Trades', '/trades'], ['Terminal', '/terminal'], ['Market', '/market'], ['Help', '/help'],
  ['History', '/history'], ['Profile', '/profile'], ['Scanner', '/scanner'], ['Skill Hub', '/skill-hub'], ['Withdraw', '/withdraw'],
  ['Notifications', '/notifications'], ['Settings', '/settings'], ['Tasks & Rewards', '/rewards'], ['Funded', '/funded'], ['Invite', '/invite'], ['Profile hub', '/profile']];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const reg = await (await fetch(APP + '/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ fullName: 'Button Test', email: `btn${Date.now()}@test.local`, password: 'password123' }) })).json();

const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'oa-e2e-'))}`, 'about:blank'], { stdio: 'ignore' });
let ws, id = 0;
const pending = new Map();
const errors = [];
const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.value;
const LIST = `[...document.querySelectorAll('[tabindex="0"],[role=button],[role=tab],[role=link],a[href],input,[role=switch]')]
  .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })`;
const STATE = `location.pathname + location.search + '|' + document.body.innerText.length + '|' + document.querySelectorAll('*').length`;

const rows = [];
try {
  let targets = [];
  for (let i = 0; i < 40 && !targets.length; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch {} await sleep(500); }
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.once('open', r));
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 160));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: APP + '/' }); await sleep(4000);
  if (process.env.THEME) await evaluate(`localStorage.setItem('oliskey-alpha.theme', '${process.env.THEME}')`);
  await evaluate(`localStorage.setItem('oliskey-alpha.session', ${JSON.stringify(reg.token)})`);

  for (const [screen, path] of SCREENS) {
    await send('Page.navigate', { url: APP + path }); await sleep(3500);
    const items = await evaluate(`${LIST}.slice(0, 25).map((e) => { const r = e.getBoundingClientRect(); const tapEl = e.querySelector(':scope > [data-testid="tap-area"]'); const t = tapEl ? tapEl.getBoundingClientRect() : null;
      return { label: (e.getAttribute('aria-label') || e.innerText || e.getAttribute('placeholder') || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
               w: Math.round(Math.max(r.width, t ? t.width : 0)), h: Math.round(Math.max(r.height, t ? t.height : 0)), input: e.tagName === 'INPUT' }; })`) ?? [];
    for (const [i, item] of items.entries()) {
      if (SKIP.test(item.label)) { rows.push({ screen, ...item, effect: 'skipped' }); continue; }
      if (i > 0) { await send('Page.navigate', { url: APP + path }); await sleep(2200); }
      const before = await evaluate(STATE);
      await evaluate(`(() => { const e = ${LIST}[${i}]; if (e) { e.scrollIntoView({ block: 'center' }); e.click(); e.focus?.(); } })()`);
      await sleep(2000);   // heavy screens (Terminal, Market) need ~1-2 s to mount after a tab press
      const after = await evaluate(STATE);
      const [p0] = before.split('|'), [p1] = after.split('|');
      rows.push({ screen, ...item, effect: item.input ? 'input' : p0 !== p1 ? `navigates to ${p1}` : before !== after ? 'changes screen' : 'NO VISIBLE EFFECT' });
    }
  }
} finally { ws?.close(); edge.kill(); }

const dead = rows.filter((r) => r.effect === 'NO VISIBLE EFFECT');
const small = rows.filter((r) => !r.input && (r.w < 44 || r.h < 44));
const unlabeled = rows.filter((r) => !r.label);
const md = [
  `# Button check (${new Date().toISOString().slice(0, 16)} UTC, phone 390x844)`, '',
  `Pressed ${rows.length} elements on ${SCREENS.length} screens. No visible effect: ${dead.length}. Under 44 px: ${small.length}. No label: ${unlabeled.length}. Script errors: ${errors.length}.`, '',
  '| Screen | Element | Size | Result |', '|---|---|---|---|',
  ...rows.map((r) => `| ${r.screen} | ${r.label || '(no label)'} | ${r.w}x${r.h}${!r.input && (r.w < 44 || r.h < 44) ? ' (small)' : ''} | ${r.effect} |`),
  '', errors.length ? `Script errors:\n${errors.map((e) => `- ${e}`).join('\n')}` : 'No script errors.',
].join('\n');
writeFileSync(new URL('../docs/audit/buttons.md', import.meta.url), md + '\n');
console.log(md.split('\n')[2]);
for (const r of dead) console.log(`  no effect: ${r.screen} / ${r.label}`);
