// AI Spot pipeline + paper exchange: eligibility, entry timing, idempotency, partial fills, stops. No server needed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateTradeProposal } from '../src/spot/contracts.js';
import { PaperExchange } from '../src/spot/paperExchange.js';
import { decide, eligibility, entryTiming, loadRegistry } from '../src/spot/pipeline.js';
import { KillSwitch } from '../src/spot/risk.js';

const iso = (ms) => new Date(Date.now() + ms).toISOString();
const proposal = (over = {}) => ({ schemaVersion: '1.0', proposalId: `p-${Math.random()}`, agentId: 'test', strategyId: 'balanced_swing',
  strategyVersion: '0.1.0', symbol: 'BTC/USDT', timeframe: '4h', action: 'OPEN_LONG', createdAt: iso(-1000), expiresAt: iso(3600_000),
  candleCloseAt: iso(-2000), entryPrice: 100_000, stopLoss: 97_000, takeProfit: 106_000, confidence: { value: 0.6, calibrated: false },
  marketRegime: 'TRENDING_UP', expectedNetRewardRisk: 1.9, reasoningSummary: 'test', supportingEvidence: [], invalidationConditions: [], ...over });
const account = () => ({ equity: 10_000, peakEquity: 10_000, dayStartEquity: 10_000, dayPnl: 0, availableQuote: 10_000, exposure: 0,
  openRisk: 0, openPositions: 0, strategyRisk: {}, ordersLastHour: 0, ordersToday: 0 });
const market = (over = {}) => ({ bid: 99_990, ask: 100_010, atr: 1500, ...over });
const approved = { strategies: [{ strategy_id: 'balanced_swing', version: '0.1.0', symbol: 'BTCUSDT', verdict: 'APPROVED_FOR_PAPER' }] };

test('contract: a long with its stop above entry, or a short action, is invalid', () => {
  assert.equal(validateTradeProposal(proposal()).ok, true);
  assert.equal(validateTradeProposal(proposal({ stopLoss: 101_000 })).ok, false);
  assert.equal(validateTradeProposal(proposal({ action: 'OPEN_SHORT' })).ok, false);
  assert.equal(validateTradeProposal(proposal({ confidence: 0.9 })).ok, false);
});

test('the real lab registry is obeyed: a strategy the lab rejected never reaches the exchange', async () => {
  const reg = loadRegistry();
  assert.ok(reg.strategies.length >= 8, 'the lab results are present');
  const rejected = reg.strategies.find((s) => s.verdict !== 'APPROVED_FOR_PAPER');
  assert.ok(rejected, 'at least one strategy is not approved');
  const ex = new PaperExchange();
  ex.onPrice('BTC/USDT', 100_000);
  const p = proposal({ strategyId: rejected.strategy_id, strategyVersion: rejected.version, symbol: rejected.symbol.replace('USDT', '/USDT') });
  ex.onPrice(p.symbol, 100_000);
  const d = await decide({ proposal: p, account: account(), market: market(), killSwitch: new KillSwitch(null), exchange: ex, registry: reg });
  assert.equal(d.finalStatus, 'REJECTED');
  assert.match(d.supervisor.reasons[0], /by the lab/);
  assert.equal(ex.orders.size, 0, 'no order reached the exchange');
});

test('live mode is never eligible from the pipeline', () => {
  assert.equal(eligibility(approved, proposal(), 'live').ok, false);
});

test('entry timing: expired, unclosed candle, wide spread, chasing', () => {
  assert.equal(entryTiming(proposal({ expiresAt: iso(-1) }), market()).decision, 'NO_TRADE');
  assert.equal(entryTiming(proposal({ candleCloseAt: iso(60_000) }), market()).decision, 'WAIT_FOR_CANDLE_CLOSE');
  assert.equal(entryTiming(proposal(), market({ bid: 99_000, ask: 101_000 })).decision, 'REJECT_ENTRY');
  assert.equal(entryTiming(proposal(), market({ bid: 101_990, ask: 102_000 })).decision, 'WAIT_FOR_PULLBACK');
  assert.equal(entryTiming(proposal(), market()).decision, 'ENTER_NOW');
});

test('an approved paper trade buys, places a stop sized to the fill, and logs every stage', async () => {
  const ex = new PaperExchange();
  ex.onPrice('BTC/USDT', 100_010);
  const log = [];
  const d = await decide({ proposal: proposal(), account: account(), market: market(), killSwitch: new KillSwitch(null), exchange: ex, registry: approved, journal: (x) => log.push(x) });
  assert.equal(d.finalStatus, 'EXECUTED');
  assert.equal(d.risk.status, 'APPROVED');
  assert.ok(d.risk.actualRisk <= 100);
  const stop = [...ex.orders.values()].find((o) => o.type === 'STOP_MARKET');
  assert.equal(stop.qty, d.execution.filledQty);
  assert.equal(log.length, 1);
  ex.onPrice('BTC/USDT', 96_000);                                 // gap through the stop
  assert.equal(stop.status, 'FILLED');
  assert.equal(ex.getBalances().BTC, 0);
  const lost = 10_000 - ex.getBalances().USDT;
  assert.ok(lost > 0 && lost < 160, `a gap can cost more than 1%, but bounded here: ${lost}`);
});

test('paper exchange is idempotent: a retried order never fills twice', () => {
  const ex = new PaperExchange();
  ex.onPrice('ETH/USDT', 3000);
  const a = ex.placeOrder({ clientOrderId: 'same', symbol: 'ETH/USDT', side: 'BUY', qty: 0.1 });
  const b = ex.placeOrder({ clientOrderId: 'same', symbol: 'ETH/USDT', side: 'BUY', qty: 0.1 });
  assert.equal(a, b);
  assert.equal(ex.getBalances().ETH, 0.1);
});

test('paper exchange refuses to sell what it does not hold (spot cannot short)', () => {
  const ex = new PaperExchange();
  ex.onPrice('ETH/USDT', 3000);
  assert.equal(ex.placeOrder({ clientOrderId: 's1', symbol: 'ETH/USDT', side: 'SELL', qty: 0.1 }).status, 'REJECTED');
});

test('a partial fill gets a stop for exactly the filled amount, and the rest is cancelled', async () => {
  const ex = new PaperExchange({ partialFillRatio: 0.5 });
  ex.onPrice('BTC/USDT', 100_010);
  const d = await decide({ proposal: proposal(), account: account(), market: market(), killSwitch: new KillSwitch(null), exchange: ex, registry: approved });
  assert.equal(d.finalStatus, 'EXECUTED');
  const entry = [...ex.orders.values()].find((o) => o.side === 'BUY');
  const stop = [...ex.orders.values()].find((o) => o.type === 'STOP_MARKET');
  assert.ok(entry.filledQty < entry.qty);
  assert.equal(stop.qty, entry.filledQty);
  assert.equal(entry.status, 'PARTIALLY_FILLED_CANCELED');
});

test('kill switch on: approved strategy still cannot trade', async () => {
  const k = new KillSwitch(null);
  k.trip('test', 'owner');
  const ex = new PaperExchange();
  ex.onPrice('BTC/USDT', 100_010);
  const d = await decide({ proposal: proposal(), account: account(), market: market(), killSwitch: k, exchange: ex, registry: approved });
  assert.equal(d.finalStatus, 'REJECTED');
  assert.equal(ex.orders.size, 0);
});
