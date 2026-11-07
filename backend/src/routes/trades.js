import { Router } from 'express';
import { pool } from '../db.js';
import { isUuid } from '../http.js';
import { MODES, openTrade, orderError } from '../openTrade.js';
import { analyzeTrade, tradeFacts } from '../ai.js';

const RESULTS = ['win', 'loss', 'refund'];

export function tradesRouter({ engine, settlement, assetNames }) {
  const r = Router();

  r.post('/trades', async (req, res) => {
    const err = orderError(req.body, engine);
    if (err) return res.status(400).json({ error: err });
    res.status(201).json(await openTrade({ userId: req.user.id, order: req.body, engine, settlement }));
  });

  // Risk-free trades left today on an account (3 a day on demo; none on real-money accounts for now).
  // The owner's real numbers for one account (Profile): finished trades only.
  r.get('/stats', async (req, res) => {
    if (!isUuid(req.query.accountId)) return res.status(400).json({ error: 'Choose an account.' });
    const { rows } = await pool.query(
      `select count(*)::int as total, count(*) filter (where result = 'win')::int as wins,
              count(*) filter (where result in ('win', 'loss'))::int as decided,
              max(pnl) filter (where pnl > 0) as best, coalesce(sum(pnl), 0) as profit
       from trades where user_id = $1 and account_id = $2 and status = 'closed'`, [req.user.id, req.query.accountId]);
    res.json(rows[0]);
  });

  r.get('/risk-free', async (req, res) => {
    if (!isUuid(req.query.accountId)) return res.status(400).json({ error: 'Choose an account.' });
    const { rows } = await pool.query(
      `select a.type, (select count(*)::int from trades t where t.account_id = a.id and t.risk_free and t.open_time >= date_trunc('day', now())) as used
       from accounts a where a.id = $1 and a.user_id = $2`, [req.query.accountId, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' });
    const limit = rows[0].type === 'DEMO' ? 3 : 0;
    res.json({ limit, used: rows[0].used, left: Math.max(0, limit - rows[0].used) });
  });

  r.get('/trades', async (req, res) => {
    const q = req.query;
    const params = [req.user.id];
    const where = ['user_id = $1'];
    const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (MODES.includes(q.mode)) add('mode = ?', q.mode);
    if (q.status === 'open' || q.status === 'closed') add('status = ?', q.status);
    if (isUuid(q.accountId)) add('account_id = ?', q.accountId);
    if (typeof q.assetId === 'string' && engine.has(q.assetId)) add('asset_id = ?', q.assetId);
    if (RESULTS.includes(q.result)) add('result = ?', q.result);
    // finished trades go by when they finished, so what ended today comes first even if it opened on an earlier day
    const time = q.status === 'closed' ? 'close_time' : 'open_time';
    if (q.from && !isNaN(Date.parse(q.from))) add(`${time} >= ?`, new Date(q.from));
    if (q.to && !isNaN(Date.parse(q.to))) add(`${time} <= ?`, new Date(q.to));
    if (q.cursor && !isNaN(Date.parse(q.cursor))) add(`${time} < ?`, new Date(q.cursor));
    const limit = Math.min(Math.max(Math.trunc(Number(q.limit)) || 30, 1), 100);
    const { rows } = await pool.query(
      `select * from trades where ${where.join(' and ')} order by ${time} desc limit ${limit}`, params);
    res.json({ trades: rows, nextCursor: rows.length === limit ? rows.at(-1)[time] : null });
  });

  r.get('/trades/:id', async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Trade not found.' });
    const { rows } = await pool.query('select * from trades where id = $1 and user_id = $2', [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Trade not found.' });
    const ticks = await pool.query('select ts, price from quote_ticks where trade_id = $1 order by ts', [req.params.id]);
    res.json({ ...rows[0], ticks: ticks.rows });
  });

  r.post('/trades/:id/close', async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Trade not found.' });
    const { rows } = await pool.query(
      "select mode from trades where id = $1 and user_id = $2 and status = 'open'", [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'This trade is already closed.' });
    if (rows[0].mode !== 'forex') return res.status(400).json({ error: 'Only multiplier trades can be closed early.' });
    const closed = await settlement.closeNow(req.params.id);
    if (!closed) return res.status(409).json({ error: 'This trade is already closing.' });
    res.json(closed);
  });

  // Close Early (Fixed Time): the app polls the quote to show the amount live, then confirms with POST.
  r.get('/trades/:id/close-early', (req, res) => {
    const trade = settlement.open.get(req.params.id);
    if (!trade || trade.user_id !== req.user.id) return res.status(404).json({ error: 'This trade has already closed.' });
    const q = settlement.earlyQuote(trade);
    res.json(q.reason ? { available: false, reason: q.reason, availableInMs: q.availableInMs ?? null }
                      : { available: true, amount: q.amount });
  });

  r.post('/trades/:id/close-early', async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Trade not found.' });
    res.json(await settlement.closeEarly(req.params.id, req.user.id));
  });

  r.post('/trades/:id/analyze', async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Trade not found.' });
    const { rows } = await pool.query(
      "select * from trades where id = $1 and user_id = $2 and status = 'closed'", [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Only closed trades can be analysed.' });
    const ticks = await pool.query('select price from quote_ticks where trade_id = $1 order by ts', [req.params.id]);
    res.json(await analyzeTrade(tradeFacts(rows[0], ticks.rows, assetNames.get(rows[0].asset_id))));
  });

  return r;
}
