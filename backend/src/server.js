import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import './env.js';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { pool } from './db.js';
import { PriceEngine, isValidTimeframe } from './priceEngine.js';
import { createStream } from './stream.js';
import { ordersRouter, startOrders } from './orders.js';
import { Settlement } from './settlement.js';
import { requireAdmin, requireAuth } from './auth.js';
import { errorHandler } from './http.js';
import { authRouter } from './routes/auth.js';
import { accountRouter } from './routes/account.js';
import { tradesRouter } from './routes/trades.js';
import { paymentsRouter, paystackWebhook, reconcileDeposits } from './routes/payments.js';
import { paystackConfigured } from './paystack.js';
import { adminRouter } from './routes/admin.js';
import { intelRouter, signalRouter, startIntel, startPaperTrading, startSignalAlerts } from './intel.js';
import { pushRouter } from './webPush.js';
import { spotRouter } from './routes/spot.js';
import { KillSwitch } from './spot/risk.js';
import { whenLeader } from './leader.js';
import { setNotifyPush } from './notify.js';

const PORT = Number(process.env.PORT) || 3311;
const brotli = promisify(zlib.brotliCompress), gzip = promisify(zlib.gzip);
const WEB_DIR = process.env.WEB_DIR || path.resolve(import.meta.dirname, '../../app/dist');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

const { rows: assets } = await pool.query(
  `select id, name, category, base_price, decimals, volatility, payout_fixed, payout_inzone, max_leverage, sort_order,
          price_source, source_symbol
   from assets where is_active order by sort_order`,
);
const engine = new PriceEngine(assets);
// Price snapshot (simulated history incl. 6 months of 15 min candles, ~40 MB). Kept outside OneDrive on Windows
// so it is not re-uploaded every 5 minutes; PRICE_SNAPSHOT overrides the location.
const LEGACY_SNAPSHOT = path.resolve(import.meta.dirname, '../.data/prices.bin');
const PRICE_SNAPSHOT = process.env.PRICE_SNAPSHOT
  || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'oliskey-alpha', 'prices.bin') : LEGACY_SNAPSHOT);
if (PRICE_SNAPSHOT !== LEGACY_SNAPSHOT && !existsSync(PRICE_SNAPSHOT) && existsSync(LEGACY_SNAPSHOT)) {
  mkdirSync(path.dirname(PRICE_SNAPSHOT), { recursive: true });
  renameSync(LEGACY_SNAPSHOT, PRICE_SNAPSHOT);
}
await engine.start(PRICE_SNAPSHOT);
// Save price history every 5 minutes and on shutdown so charts and past trades survive restarts.
setInterval(() => engine.save(PRICE_SNAPSHOT), 5 * 60_000).unref();
const closeDown = () => { engine.save(PRICE_SNAPSHOT); process.exit(0); };
process.on('message', (m) => { if (m === 'shutdown') closeDown(); });   // from scripts/run-server.mjs
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, closeDown);
}

const app = express();
// Trust X-Forwarded-For only when a proxy really sits in front (Render/Railway: TRUST_PROXY=1). Trusting it
// without one lets any client fake its IP and slip past the rate limits.
app.set('trust proxy', Number(process.env.TRUST_PROXY || 0));
app.use(helmet());
app.use(cors({ origin: ALLOWED_ORIGINS }));
// ── Web app on the same port ──
// Serves the exported Expo web build (npm run build). Browser page loads ask for HTML and get the app;
// API calls from the app ask for JSON and fall through to the routes below.
// The build is swapped in as a whole (app/dist-next -> app/dist), so for a moment during an update, or before the
// first build, there may be no app: browsers then get a small branded page that retries, never a raw error.
const UPDATING_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="3"><title>Oliskey Alpha</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#000;color:#F2F2F2;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
.c{text-align:center;padding:24px}.l{width:56px;height:56px;border-radius:16px;margin:0 auto 20px;background:linear-gradient(135deg,#7C5CFF,#3BA4FF);display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:700}
h1{font-size:20px;margin:0 0 8px}p{color:#8E8E8E;margin:0;font-size:15px}.d{width:28px;height:28px;margin:22px auto 0;border:3px solid #2C2C2C;border-top-color:#7C5CFF;border-radius:50%;animation:s 1s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.d{animation:none}}</style></head>
<body><div class="c"><div class="l">α</div><h1>Oliskey Alpha is updating</h1><p>This takes a few seconds. The page reloads by itself.</p><div class="d"></div></div></body></html>`;
// Built files have their content hash in the name, so they can be cached for good and are compressed once, then kept in
// memory. This cuts the app's first download by about 85% and returning visitors download nothing.
const LONG_CACHE = 'public, max-age=31536000, immutable';
const packed = new Map();
app.use('/_expo/static', async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const wants = String(req.headers['accept-encoding'] ?? '');
  const encoding = /\bbr\b/.test(wants) ? 'br' : /\bgzip\b/.test(wants) ? 'gzip' : null;
  const file = path.normalize(path.join(WEB_DIR, '_expo/static', decodeURIComponent(req.path)));
  if (!encoding || !/\.(js|css)$/.test(file) || !file.startsWith(path.normalize(path.join(WEB_DIR, '_expo/static')))) return next();
  const key = `${encoding}:${file}`;
  try {
    if (!packed.has(key)) {
      if (packed.size > 200) packed.clear();   // old builds' files
      const raw = await readFile(file);
      packed.set(key, encoding === 'br'
        ? await brotli(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 7 } })
        : await gzip(raw, { level: 8 }));
    }
    res.set({ 'Content-Encoding': encoding, 'Cache-Control': LONG_CACHE, Vary: 'Accept-Encoding' }).type(path.extname(file)).send(packed.get(key));
  } catch {
    next();   // not there: the normal handling below answers
  }
});
app.use(express.static(WEB_DIR, {
  index: false, redirect: false,
  setHeaders: (res, file) => { if (/[\\/](_expo[\\/]static|assets)[\\/]/.test(file)) res.set('Cache-Control', LONG_CACHE); },
}));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.accepts(['json', 'html']) !== 'html') return next();
  res.sendFile(path.join(WEB_DIR, 'index.html'), (err) => {
    if (err && !res.headersSent) res.status(503).set('Retry-After', '3').type('html').send(UPDATING_PAGE);
  });
});

// API limit. It comes after the web app: one page load is dozens of file requests, and people on one mobile network
// share an IP, so counting files here would give them blank pages.
// A client that vanished mid-request has no address; the limiter cannot key it, and nobody is waiting for the answer.
app.use((req, res, next) => (req.ip ? next() : res.destroy()));
// 300 requests a minute per address in production; the test suite (one address, hundreds of requests) raises it with RATE_LIMIT.
app.use(rateLimit({ windowMs: 60_000, limit: Number(process.env.RATE_LIMIT) || 300, standardHeaders: 'draft-8', legacyHeaders: false }));
// Keep the raw body for the Paystack webhook signature check.
app.use(express.json({ limit: '100kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

// ── Public ──
app.get('/health', (_req, res) => res.json({ ok: true, assets: assets.length }));

app.get('/assets', (_req, res) => {
  res.json(assets.map((a) => ({ ...a, price: engine.getPrice(a.id)?.price ?? null })));
});

app.get('/price/:asset', (req, res) => {
  const tick = engine.getPrice(req.params.asset);
  if (!tick) return res.status(404).json({ error: 'Unknown asset' });
  res.json({ asset: req.params.asset, ...tick });
});

// The InZone corridor a trade would get right now, so the chart shows what will really apply.
app.get('/zone/:asset', (req, res) => {
  const durationSec = Number(req.query.durationSec);
  if (!engine.has(req.params.asset)) return res.status(404).json({ error: 'Unknown asset' });
  if (!Number.isInteger(durationSec) || durationSec < 5 || durationSec > 14400) return res.status(400).json({ error: 'durationSec must be 5-14400' });
  res.json({ zonePct: engine.isLive(req.params.asset) ? engine.liveZonePct(req.params.asset, durationSec) : null });
});

// Order flow behind the momentum bar (real buy/sell volume for live crypto, price ticks for every asset).
// People online = real WebSocket connections right now (no padding, no fake numbers).
let onlineCount = () => 0;
app.get('/online', (_req, res) => res.json({ online: onlineCount() }));

app.get('/flow/:asset', (req, res) => {
  const tf = Number(req.query.tf ?? 60);
  const flow = engine.getFlow(req.params.asset, isValidTimeframe(tf) ? tf : 60);
  if (!flow) return res.status(404).json({ error: 'Unknown asset' });
  res.json(flow);
});

// Real buy/sell volume per candle for live crypto (Volume and Sentiment indicators); empty for simulated assets.
app.get('/volume/:asset', (req, res) => {
  const tf = Number(req.query.tf ?? 60);
  const vol = engine.getVolume(req.params.asset, isValidTimeframe(tf) ? tf : 60);
  if (!vol) return res.status(404).json({ error: 'Unknown asset' });
  res.json(vol);
});

app.get('/candles/:asset', (req, res) => {
  if (!engine.has(req.params.asset)) return res.status(404).json({ error: 'Unknown asset' });
  const tf = Number(req.query.tf ?? 5);
  const count = Number(req.query.count ?? 120);
  if (!isValidTimeframe(tf)) return res.status(400).json({ error: 'tf must be a multiple of 5 s up to 3600, or of 900 s up to 86400' });
  if (!Number.isInteger(count) || count < 1 || count > 5000) return res.status(400).json({ error: 'count must be 1-5000' });
  res.json(engine.getCandles(req.params.asset, tf, count));
});

app.use('/auth', authRouter);
app.post('/payments/paystack/webhook', paystackWebhook);


// ── Signed in ──
const server = http.createServer(app);
const stream = createStream(server, engine, assets.map((a) => a.id));
onlineCount = stream.online;
setNotifyPush(stream.push);
const settlement = new Settlement(engine, stream.push);
let reloaded = 0;

app.use(requireAuth);
app.use(accountRouter);
app.use(tradesRouter({ engine, settlement, assetNames: new Map(assets.map((a) => [a.id, a.name])) }));
const orders = startOrders({ engine, settlement, push: stream.push });
app.use(ordersRouter({ engine, orders }));
app.use(paymentsRouter);
app.use(pushRouter);
// AI Spot kill switch lives on the permanent disk (Railway /data, Windows %LOCALAPPDATA%), so a restart or deploy never clears it.
const SPOT_KILL_SWITCH = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'oliskey-alpha', 'spot-kill-switch.json')
  : fileURLToPath(new URL('../.data/spot-kill-switch.json', import.meta.url));
app.use(spotRouter({ killSwitch: new KillSwitch(SPOT_KILL_SWITCH), pool }));
app.use('/admin', requireAdmin, adminRouter);
app.use('/intel', signalRouter({ engine, settlement, orders }));
app.use('/intel', intelRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

server.listen(PORT, () => console.log(`Oliskey Alpha backend on http://localhost:${PORT}`));
// Every copy serves the website, the API and live prices. Only the leader settles, fills orders and runs the AI (leader.js).
whenLeader(async () => {
  reloaded = await settlement.start();
  console.log(`Settling: ${reloaded} open trades reloaded`);
  await orders.start();
  startSignalAlerts();
  if (paystackConfigured()) {   // deposits the webhook missed: re-checked with Paystack every 5 minutes
    setInterval(() => reconcileDeposits().catch((err) => console.error('deposit reconcile', err.message)), 5 * 60_000).unref();
  }
  if (process.env.INTEL_DISABLED !== '1') {
    startIntel();
    startPaperTrading({ engine, settlement });
  }
});
