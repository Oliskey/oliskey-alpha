// AI Spot Risk Manager: sizing, limits, kill switch. Pure, no server needed.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_FILTERS, DEFAULT_LIMITS, KillSwitch, evaluate, exitOrder, roundQty, sizeLong } from '../src/spot/risk.js';

const later = () => new Date(Date.now() + 3600_000).toISOString();
const proposal = (over = {}) => ({ proposalId: 'p1', action: 'OPEN_LONG', symbol: 'BTC/USDT', strategyId: 'balanced_swing',
  strategyVersion: '0.1.0', entryPrice: 100_000, stopLoss: 98_000, takeProfit: 104_000, expiresAt: later(), ...over });
const account = (over = {}) => ({ equity: 10_000, peakEquity: 10_000, dayStartEquity: 10_000, dayPnl: 0, availableQuote: 10_000,
  exposure: 0, openRisk: 0, openPositions: 0, strategyRisk: {}, ordersLastHour: 0, ordersToday: 0, ...over });
const ks = () => new KillSwitch(null);

test('a stop-out costs at most 1% of equity, fees and slippage included', () => {
  const r = evaluate({ proposal: proposal(), account: account(), killSwitch: ks() });
  assert.equal(r.status, 'APPROVED');
  assert.ok(r.actualRisk <= 100 + 1e-9, `risk ${r.actualRisk}`);
  assert.ok(r.actualRisk > 90, 'uses most of the budget');
  assert.equal(r.order.side, 'BUY');
  assert.equal(r.order.qty, roundQty(r.order.qty, DEFAULT_FILTERS['BTC/USDT'].stepSize));
});

test('property: for 5,000 random trades, approved risk never exceeds the permitted risk', () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  let approved = 0;
  for (let i = 0; i < 5000; i++) {
    const entry = 100 + rnd() * 150_000;
    const stop = entry * (1 - (0.0005 + rnd() * 0.2));
    const eq = 20 + rnd() * 1_000_000;
    const acc = account({ equity: eq, peakEquity: eq, dayStartEquity: eq, availableQuote: eq * rnd(), openRisk: eq * 0.02 * rnd() });
    const sym = rnd() < 0.5 ? 'BTC/USDT' : 'ETH/USDT';
    const r = evaluate({ proposal: proposal({ symbol: sym, entryPrice: entry, stopLoss: stop, takeProfit: entry * 1.05 }), account: acc, killSwitch: ks() });
    if (r.status !== 'APPROVED') continue;
    approved++;
    const f = DEFAULT_FILTERS[sym];
    assert.ok(r.actualRisk <= eq * DEFAULT_LIMITS.maxRiskPerTrade + 1e-6, `risk ${r.actualRisk} > 1% of ${eq}`);
    assert.ok(r.actualRisk <= r.permittedRisk + 1e-9);
    assert.ok(acc.openRisk + r.actualRisk <= eq * DEFAULT_LIMITS.maxOpenRisk + 1e-6, 'open risk limit');
    assert.ok(r.order.qty * entry <= acc.availableQuote + 1e-6, 'never spends money it does not have');
    assert.ok(r.order.qty >= f.minQty && r.order.qty * entry >= f.minNotional, 'exchange minimums');
    assert.ok(Math.abs(r.order.qty / f.stepSize - Math.round(r.order.qty / f.stepSize)) < 1e-6, 'step size');
  }
  assert.ok(approved > 500, `enough cases exercised (${approved})`);
});

test('property: a stop at or above the entry is always rejected for a long', () => {
  for (const stop of [100_000, 100_001, 150_000]) {
    const r = sizeLong({ equity: 1e4, availableQuote: 1e4, exposureHeadroom: 6e3, riskFraction: 0.01, entry: 100_000, stop, filters: DEFAULT_FILTERS['BTC/USDT'] });
    assert.ok(r.reject, `stop ${stop} accepted`);
  }
  const r = evaluate({ proposal: proposal({ stopLoss: 100_000 }), account: account(), killSwitch: ks() });
  assert.equal(r.status, 'REJECTED');
});

test('too-small orders are rejected, never rounded up into more risk', () => {
  const r = evaluate({ proposal: proposal({ stopLoss: 50_000 }), account: account({ equity: 50, peakEquity: 50, dayStartEquity: 50, availableQuote: 50 }), killSwitch: ks() });
  assert.equal(r.status, 'REJECTED');
  assert.match(r.rulesFailed.join(), /minimum/);
});

test('daily loss limit trips the persistent kill switch; it blocks new orders until a person clears it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ks-'));
  const k = new KillSwitch(join(dir, 'ks.json'));
  const r = evaluate({ proposal: proposal(), account: account({ dayPnl: -300, equity: 9700 }), killSwitch: k });
  assert.equal(r.status, 'REJECTED');
  assert.equal(k.on, true);
  const again = new KillSwitch(join(dir, 'ks.json'));                    // survives a restart
  assert.equal(again.on, true);
  assert.equal(evaluate({ proposal: proposal(), account: account(), killSwitch: again }).status, 'REJECTED');
  assert.throws(() => again.clear({ by: 'timer', reason: 'time passed' }));
  assert.throws(() => again.clear({ by: 'owner' }), /reason/);
  again.clear({ by: 'owner', reason: 'reviewed the losses' });
  assert.equal(evaluate({ proposal: proposal(), account: account(), killSwitch: again }).status, 'APPROVED');
  const log = readFileSync(join(dir, 'ks.json.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(log.map((e) => e.action), ['trip', 'clear']);
});

test('max drawdown trips the kill switch', () => {
  const k = ks();
  evaluate({ proposal: proposal(), account: account({ equity: 8_900, peakEquity: 10_000, dayStartEquity: 8_900 }), killSwitch: k });
  assert.equal(k.on, true);
});

test('limits: positions, frequency, expiry, missing account data and missing kill switch all fail closed', () => {
  const k = ks();
  assert.equal(evaluate({ proposal: proposal(), account: account({ openPositions: 4 }), killSwitch: k }).status, 'REJECTED');
  assert.equal(evaluate({ proposal: proposal(), account: account({ ordersLastHour: 20 }), killSwitch: k }).status, 'REJECTED');
  assert.equal(evaluate({ proposal: proposal({ expiresAt: new Date(Date.now() - 1).toISOString() }), account: account(), killSwitch: k }).status, 'REJECTED');
  assert.equal(evaluate({ proposal: proposal(), account: { equity: 1e4 }, killSwitch: k }).status, 'REJECTED');
  assert.equal(evaluate({ proposal: proposal(), account: account() }).status, 'REJECTED');
  assert.equal(evaluate({ proposal: proposal(), account: account({ openRisk: 300 }), killSwitch: k }).status, 'REJECTED');
});

test('remaining daily-loss room shrinks the next trade instead of breaking the limit', () => {
  const r = evaluate({ proposal: proposal(), account: account({ dayPnl: -250, equity: 9_750 }), killSwitch: ks() });
  assert.equal(r.status, 'APPROVED');
  assert.ok(r.actualRisk <= 50 + 1e-9, `risk ${r.actualRisk} must fit the 50 left today`);
});

test('an exit can never sell more than is held (no accidental short)', () => {
  const e = exitOrder({ position: { id: 'x', symbol: 'ETH/USDT', qty: 0.12345678, lastPrice: 3000 }, reason: 'stop' });
  assert.equal(e.order.side, 'SELL');
  assert.ok(e.order.qty <= 0.12345678);
  assert.equal(exitOrder({ position: { id: 'y', symbol: 'ETH/USDT', qty: 0, lastPrice: 3000 }, reason: 'stop' }).status, 'REJECTED');
});
