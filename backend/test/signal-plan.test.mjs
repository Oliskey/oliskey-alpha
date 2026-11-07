// The signal plan's money and status rules. Pure sums, no server needed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixedTimePlan, signalPlan } from '../src/signalPlan.js';

const later = new Date(Date.now() + 3600_000).toISOString();
const idea = (over = {}) => ({ id: 1, asset_id: 'BTCUSD', kind: 'idea', status: 'open', direction: 1, entry: 100, stop: 95, target: 110, enter_until: later, expires_at: later, probability: 0.55, ...over });
const base = { idea: idea(), price: 100, live: true, balance: 10000, maxLeverage: 100 };

test('a stop-out costs about 1% of the balance', () => {
  const p = signalPlan(base);
  assert.equal(p.status, 'start');
  assert.equal(p.mode, 'forex');
  assert.ok(Math.abs(p.stopMoney - 100) < 1, `stop money ${p.stopMoney}`);
  assert.ok(p.amount <= 2000, 'stake stays under 20% of the balance');
  assert.ok(Math.abs(p.targetMoney - 200) < 2, `target money ${p.targetMoney}`);
  assert.ok(Math.abs(p.riskPct - 1) < 0.02);
});

test('a tight stop raises the multiplier instead of the stake', () => {
  const p = signalPlan({ ...base, idea: idea({ stop: 99.9, target: 100.2 }) });
  assert.ok(p.amount <= 2000);
  assert.ok(p.leverage > 1);
  assert.ok(Math.abs(p.stopMoney - 100) < 2, `stop money ${p.stopMoney}`);
});

test('the market limit on the multiplier lowers the risk, never raises it', () => {
  const p = signalPlan({ ...base, idea: idea({ stop: 99.99, target: 100.02 }), maxLeverage: 10 });
  assert.equal(p.leverage, 10);
  assert.ok(p.riskPct <= 1);
});

test('a loss at the stop never exceeds the stake', () => {
  for (const stop of [99.99, 99.5, 95, 80, 50]) {
    const p = signalPlan({ ...base, idea: idea({ stop, target: 100 + (100 - stop) * 2 }) });
    assert.ok(p.stopMoney <= p.amount + 0.01, `stop ${stop}: ${p.stopMoney} vs ${p.amount}`);
  }
});

test('changing the amount moves stop and target money with it', () => {
  const a = signalPlan(base), b = signalPlan({ ...base, amount: a.amount * 2 });
  assert.equal(b.leverage, a.leverage);
  assert.ok(Math.abs(b.stopMoney - a.stopMoney * 2) < 0.05);
  assert.equal(b.suggestedAmount, a.suggestedAmount);
});

test('demo and real balances size the same way', () => {
  const p = signalPlan({ ...base, balance: 500 });
  assert.ok(Math.abs(p.stopMoney - 5) < 0.1);
});

test('a very small balance is flagged', () => {
  const p = signalPlan({ ...base, balance: 2 });
  assert.equal(p.tooSmall, true);
  assert.equal(p.amount, 1);
});

test('statuses: start, wait, hold, waiting order, done, missed', () => {
  assert.equal(signalPlan({ ...base, price: 100.5 }).status, 'start');
  assert.equal(signalPlan({ ...base, price: 103 }).status, 'wait');
  assert.equal(signalPlan({ ...base, price: 111 }).status, 'missed');
  assert.equal(signalPlan({ ...base, price: 111 }).reason, 'passed_target');
  assert.equal(signalPlan({ ...base, price: 94 }).reason, 'passed_stop');
  assert.equal(signalPlan({ ...base, idea: idea({ enter_until: new Date(Date.now() - 1000).toISOString() }) }).reason, 'expired');
  assert.equal(signalPlan({ ...base, trade: { id: 't', status: 'open' } }).status, 'hold');
  assert.equal(signalPlan({ ...base, trade: { id: 't', status: 'closed', result: 'win' } }).status, 'done');
  assert.equal(signalPlan({ ...base, order: { id: 'o' } }).status, 'waiting_order');
});

test('Fixed Time: the whole amount is what can be lost, about 1% of the balance', () => {
  const bar = new Date(Date.now() - 60_000);
  const p = fixedTimePlan({ idea: idea({ asset_class: 'crypto_ft', bar_time: bar.toISOString(), expires_at: new Date(bar.getTime() + 3600_000).toISOString() }), price: 100, balance: 10000, payout: 80 });
  assert.equal(p.mode, 'fixed_time');
  assert.equal(p.durationSec, 3600);
  assert.equal(p.status, 'start');
  assert.equal(p.amount, 100);
  assert.equal(p.stopMoney, 100);
  assert.equal(p.targetMoney, 80);
  assert.equal(p.riskPct, 1);
  assert.equal(p.stop, null);
  assert.equal(fixedTimePlan({ idea: idea(), price: 100, balance: 50, payout: 80 }).tooSmall, true);
  assert.equal(fixedTimePlan({ idea: idea({ enter_until: new Date(Date.now() - 1000).toISOString() }), price: 100, balance: 10000, payout: 80 }).status, 'missed');
  assert.equal(fixedTimePlan({ idea: idea(), price: 100, balance: 10000, payout: 80, trade: { id: 't', status: 'open' } }).status, 'hold');
});

test('InZone: no side, its own payout and length', () => {
  const start = new Date(Date.now() - 60_000);
  const p = fixedTimePlan({ idea: idea({ asset_class: 'crypto_iz', bar_time: start.toISOString(), expires_at: new Date(start.getTime() + 900_000).toISOString() }), price: 100, balance: 10000, payout: 110, mode: 'inzone' });
  assert.equal(p.mode, 'inzone');
  assert.equal(p.direction, null);
  assert.equal(p.durationSec, 900);
  assert.equal(p.targetMoney, 110);
});

test('down ideas mirror up ideas', () => {
  const d = idea({ direction: -1, stop: 105, target: 90 });
  const p = signalPlan({ ...base, idea: d });
  assert.equal(p.direction, 'down');
  assert.equal(p.status, 'start');
  assert.equal(signalPlan({ ...base, idea: d, price: 89 }).reason, 'passed_target');
  assert.equal(signalPlan({ ...base, idea: d, price: 106 }).reason, 'passed_stop');
});

test('simulated markets keep the distances from the app price and start now', () => {
  const p = signalPlan({ ...base, live: false, price: 200 });
  assert.equal(p.simulated, true);
  assert.equal(p.status, 'start');
  assert.equal(p.entry, 200);
  assert.ok(Math.abs(p.stop - 190) < 1e-9);
  assert.ok(Math.abs(p.target - 220) < 1e-9);
});
