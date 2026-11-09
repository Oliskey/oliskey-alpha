// AI Spot status for the app (login required, read-only). Shows what the lab found and whether anything may trade.
// No route here can place an order or change risk limits.
import { Router } from 'express';
import { loadRegistry } from '../spot/pipeline.js';
import { DEFAULT_LIMITS } from '../spot/risk.js';

export function spotRouter({ killSwitch }) {
  const r = Router();
  r.get('/spot/status', (_req, res) => {
    const reg = loadRegistry();
    const approved = (reg.strategies ?? []).filter((s) => s.verdict === 'APPROVED_FOR_PAPER');
    res.json({
      mode: 'paper_only',
      liveEnabled: false,
      testedAt: reg.generated_at ?? null,
      trading: approved.length ? 'paper' : 'no_trade',
      reason: approved.length ? null : 'No strategy has passed its tests yet, so the AI does not trade.',
      killSwitch: { on: killSwitch.on, reason: killSwitch.state.reason },
      limits: { maxRiskPerTrade: DEFAULT_LIMITS.maxRiskPerTrade, maxDailyLoss: DEFAULT_LIMITS.maxDailyLoss, maxDrawdown: DEFAULT_LIMITS.maxDrawdown },
      marketState: reg.market_state ?? {},
      strategies: (reg.strategies ?? []).map((s) => ({ id: s.strategy_id, version: s.version, symbol: s.symbol, timeframe: s.timeframe,
        verdict: s.verdict, trades: s.trades, expectancyR: s.expectancy_r, expectancyLowR: s.expectancy_low })),
    });
  });
  return r;
}
