// The signal alert's countdown wording: market and direction, time left to enter, and "Missed" once the window closes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signalText } from '../src/intel.js';

const now = Date.parse('2026-11-11T21:50:00Z');   // 22:50 in Lagos
const idea = { direction: 1, enter_until: '2026-11-11T22:02:00Z', expires_at: '2026-11-11T23:00:00Z' };

test('counts down the minutes left to enter, in Lagos time', () => {
  const t = signalText(idea, 'Uniswap', false, now);
  assert.equal(t.title, 'Uniswap Up · 12 min left to enter');
  assert.match(t.body, /^Enter before 23:02 \(WAT\)\. The trade ends at 00:00\. Experimental, not yet proven\. It can lose\.$/);
  assert.equal(signalText(idea, 'Uniswap', false, now + 11 * 60_000).title, 'Uniswap Up · 1 min left to enter');
});

test('a proven group drops the experimental warning but keeps the risk', () => {
  assert.match(signalText({ ...idea, direction: -1 }, 'EUR/USD', true, now).body, /The trade ends at 00:00\. It can lose\.$/);
  assert.match(signalText({ ...idea, direction: -1 }, 'EUR/USD', true, now).title, /^EUR\/USD Down/);
});

test('long windows show hours', () => {
  assert.equal(signalText({ ...idea, enter_until: '2026-11-12T00:15:00Z', expires_at: '2026-11-12T04:00:00Z' }, 'BTC/USD', true, now).title, 'BTC/USD Up · 2 h 25 min left to enter');
});

test('says Missed once the window has closed', () => {
  const t = signalText(idea, 'Uniswap', false, now + 13 * 60_000);
  assert.equal(t.title, 'Missed: Uniswap Up');
  assert.equal(t.body, 'The time to enter closed at 23:02. Wait for the next signal.');
});
