// Load test (audit phase 4): N WebSocket viewers + a steady stream of demo trades, then reports latency,
// errors, settlement lag and price-stream smoothness. LOCAL ONLY: creates throw-away users in the local DB.
// The server must run with TRUST_PROXY=1 so each simulated user can present its own IP (as behind a real proxy).
//   node scripts/load-test.mjs [viewers=1000] [tradesPerSec=200] [seconds=20] [users=200]
import '../backend/src/env.js';
import WebSocket from 'ws';
import { pool } from '../backend/src/db.js';
import { signToken } from '../backend/src/auth.js';

const [VIEWERS = 1000, RATE = 200, SECONDS = 20, USERS = 200] = process.argv.slice(2).map(Number);
const API = process.env.API_URL || 'http://localhost:3311';
const WS_URL = API.replace(/^http/, 'ws') + '/stream';
const ASSETS = ['EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSD', 'ETHUSD', 'XAUUSD'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN);
const tag = `load${Date.now()}`;

// 1. Users (straight into the DB: the sign-up trigger creates their wallets).
const { rows: users } = await pool.query(
  `insert into auth.users (email) select $1 || '-' || g || '@load.test' from generate_series(1, $2) g returning id, email`, [tag, USERS]);
const demo = await pool.query(`select user_id, id from accounts where type = 'DEMO' and user_id = any($1)`, [users.map((u) => u.id)]);
const demoOf = new Map(demo.rows.map((r) => [r.user_id, r.id]));
for (const [i, u] of users.entries()) { u.token = await signToken(u); u.ip = `10.${(i >> 8) & 255}.${i & 255}.7`; }
console.log(`users: ${users.length}`);

// 2. Viewers: each subscribes to one asset and records gaps between ticks.
const gaps = [];
let ticks = 0;
const sockets = [];
await Promise.all(Array.from({ length: VIEWERS }, (_, i) => new Promise((resolve) => {
  const ws = new WebSocket(WS_URL);
  let last = 0;
  ws.on('open', () => { ws.send(JSON.stringify({ type: 'subscribe', asset: ASSETS[i % ASSETS.length] })); resolve(); });
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.type !== 'tick') return;
    ticks++;
    const now = Date.now();
    if (last && i % 20 === 0) gaps.push(now - last);
    last = now;
  });
  ws.on('error', () => resolve());
  sockets.push(ws);
})));
console.log(`viewers connected: ${sockets.filter((s) => s.readyState === 1).length}/${VIEWERS}`);

// 3. Trades at a steady rate.
const lat = [];
const statuses = {};
const started = Date.now();
const inflight = [];
for (let n = 0; n < RATE * SECONDS; n++) {
  const due = started + (n * 1000) / RATE;
  if (due > Date.now()) await sleep(due - Date.now());
  const u = users[n % users.length];
  const t0 = performance.now();
  inflight.push(fetch(API + '/trades', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${u.token}`, 'x-forwarded-for': u.ip },
    body: JSON.stringify({ accountId: demoOf.get(u.id), assetId: ASSETS[n % ASSETS.length], mode: 'fixed_time', direction: n % 2 ? 'up' : 'down', amount: 1, durationSec: 5 }),
  }).then((r) => { lat.push(performance.now() - t0); statuses[r.status] = (statuses[r.status] ?? 0) + 1; })
    .catch(() => { statuses.network = (statuses.network ?? 0) + 1; }));
}
await Promise.all(inflight);
const sent = (Date.now() - started) / 1000;
console.log(`trades sent: ${RATE * SECONDS} in ${sent.toFixed(1)} s (${(RATE * SECONDS / sent).toFixed(0)}/s) statuses ${JSON.stringify(statuses)}`);
console.log(`POST /trades latency ms: p50 ${pct(lat, 0.5).toFixed(0)} p95 ${pct(lat, 0.95).toFixed(0)} p99 ${pct(lat, 0.99).toFixed(0)} max ${Math.max(...lat).toFixed(0)}`);

// 4. Let every trade expire and settle, then measure lag from expiry to the payout row.
await sleep(9000);
const { rows: [s] } = await pool.query(
  `select count(*) filter (where t.status = 'open') as still_open, count(*) as total,
          percentile_cont(0.5) within group (order by extract(epoch from (x.completed_at - t.expires_at)) * 1000) as p50,
          percentile_cont(0.95) within group (order by extract(epoch from (x.completed_at - t.expires_at)) * 1000) as p95,
          max(extract(epoch from (x.completed_at - t.expires_at)) * 1000) as max
   from trades t left join transactions x on x.trade_id = t.id and x.type in ('payout', 'refund')
   where t.user_id = any($1)`, [users.map((u) => u.id)]);
console.log(`settled: ${s.total - s.still_open}/${s.total}, still open ${s.still_open}; settle lag (winning trades) ms p50 ${Number(s.p50).toFixed(0)} p95 ${Number(s.p95).toFixed(0)} max ${Number(s.max).toFixed(0)}`);
const ledger = await pool.query(
  `select count(*) as bad from accounts a where a.user_id = any($1) and a.balance + a.locked <>
     (select coalesce(sum(amount), 0) from transactions x where x.account_id = a.id and x.status = 'completed')`, [users.map((u) => u.id)]);
console.log(`ledger mismatches: ${ledger.rows[0].bad}`);
console.log(`price stream: ${ticks} ticks delivered; gap between ticks ms p50 ${pct(gaps, 0.5)} p99 ${pct(gaps, 0.99)} max ${Math.max(...gaps)}`);

// 5. Clean up the throw-away users (cascades to their wallets, trades and ledger).
for (const ws of sockets) ws.close();
// One user at a time: a single big cascading delete can deadlock with settlement still writing ledger rows.
for (const u of users) await pool.query(`delete from auth.users where id = $1`, [u.id]).catch(() => {});
await pool.end();
