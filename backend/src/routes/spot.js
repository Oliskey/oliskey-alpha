// AI Spot status for the app (login required, read-only). Shows what the lab found, whether anything may trade,
// and the forward paper-trading record. No route here can place an order or change risk limits.
import { Router } from 'express';
import { loadRegistry } from '../spot/pipeline.js';
import { DEFAULT_LIMITS } from '../spot/risk.js';

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** The paper record written by intel every 4 h. Null until the first run (or when intel has never run here). */
export async function paperRecord(pool) {
  try {
    const [{ rows: s }, { rows: t }] = await Promise.all([
      pool.query(`select summary, updated_at from intel.spot_paper_summary where id = 'latest'`),
      pool.query(`select strategy_id, symbol, status, entry_at, entry, stop_now, last_price, exit_at, exit, reason, r
                  from intel.spot_paper_trades order by entry_at desc limit 30`),
    ]);
    if (!s.length) return null;
    return {
      ...s[0].summary,
      recent: t.map((r) => ({ strategy: r.strategy_id, symbol: r.symbol, status: r.status, entryAt: r.entry_at, entry: num(r.entry),
        stop: num(r.stop_now), price: num(r.last_price), exitAt: r.exit_at, exit: num(r.exit), reason: r.reason, r: num(r.r) })),
    };
  } catch (err) {
    if (err.code === '42P01' || err.code === '3F000') return null;   // tables not created yet: intel has not run
    throw err;
  }
}

export function spotRouter({ killSwitch, pool }) {
  const r = Router();
  r.get('/spot/status', async (_req, res, next) => {
    try {
      const reg = loadRegistry();
      const approved = (reg.strategies ?? []).filter((s) => s.verdict === 'APPROVED_FOR_PAPER');
      res.json({
        mode: 'paper_only',
        liveEnabled: false,
        testedAt: reg.generated_at ?? null,
        trading: approved.length ? 'paper' : 'no_trade',
        reason: approved.length
          ? 'Passed its tests on past data. Paper trading on live prices decides if it is real. No real money.'
          : 'No strategy has passed its tests yet, so the AI does not trade.',
        killSwitch: { on: killSwitch.on, reason: killSwitch.state.reason },
        limits: { maxRiskPerTrade: DEFAULT_LIMITS.maxRiskPerTrade, maxDailyLoss: DEFAULT_LIMITS.maxDailyLoss, maxDrawdown: DEFAULT_LIMITS.maxDrawdown },
        marketState: reg.market_state ?? {},
        strategies: (reg.strategies ?? []).map((s) => ({ id: s.strategy_id, version: s.version, symbol: s.symbol, coins: s.coins ?? null,
          timeframe: s.timeframe, verdict: s.verdict, trades: s.trades, expectancyR: s.expectancy_r, expectancyLowR: s.expectancy_low })),
        paper: pool ? await paperRecord(pool) : null,
      });
    } catch (err) {
      next(err);
    }
  });
  return r;
}
