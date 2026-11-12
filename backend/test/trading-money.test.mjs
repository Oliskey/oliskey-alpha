// Oliskey AI Trading money rules (no database, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { D, str, add, mul, div, round, floorToStep } from '../src/trading/decimal.js';
import { subscriptionPrice, replayPosition, commission, statement } from '../src/trading/money.js';

test('decimals are exact and refuse floats', () => {
  assert.equal(str(add('0.1', '0.2')), '0.3');
  assert.equal(str(mul('19.99', '3')), '59.97');
  assert.equal(str(div('1', '3')), '0.33333333');
  assert.equal(str(round('2.345', 2)), '2.35');
  assert.equal(str(round('2.349', 2, 'down')), '2.34');
  assert.equal(str(floorToStep('0.123456', '0.00001')), '0.12345');
  assert.throws(() => D(0.1), /string/);
  assert.throws(() => D('1.000000001'), /more than 8/);
  assert.throws(() => D('1e5'), /not a number/);
});

test('subscription: $2.50 per strategy, 1 to 4, one checkout', () => {
  assert.equal(subscriptionPrice(['a']), '2.50');
  assert.equal(subscriptionPrice(['a', 'b']), '5.00');
  assert.equal(subscriptionPrice(['a', 'b', 'c']), '7.50');
  assert.equal(subscriptionPrice(['a', 'b', 'c', 'd']), '10.00');
  assert.throws(() => subscriptionPrice([]), /1_TO_4/);
  assert.throws(() => subscriptionPrice(['a', 'b', 'c', 'd', 'e']), /1_TO_4/);
  assert.throws(() => subscriptionPrice(['a', 'a']), /DUPLICATE/);
});

const buy = (price, qty, feeQuote = '0', extra = {}) => ({ side: 'buy', price, quantity: qty, quoteQuantity: str(mul(price, qty)), feeQuote, feeAsset: 'USDT', fee: feeQuote, ...extra });
const sell = (price, qty, feeQuote = '0', extra = {}) => ({ side: 'sell', price, quantity: qty, quoteQuantity: str(mul(price, qty)), feeQuote, feeAsset: 'USDT', fee: feeQuote, ...extra });

test('realised profit counts fees and losses (average cost)', () => {
  // buy 0.1 BTC at 50,000 (fee 5), buy 0.1 at 60,000 (fee 6) → avg 55,000 + fees; sell 0.2 at 60,000 (fee 12)
  const p = replayPosition([buy('50000', '0.1', '5'), buy('60000', '0.1', '6'), sell('60000', '0.2', '12')], 'BTC');
  // proceeds 12,000 - 12 fee - cost 11,011 = 977
  assert.equal(str(p.realised), '977');
  assert.equal(str(p.quantity), '0');
  assert.equal(str(p.fees), '23');
  // a losing trade is negative
  const l = replayPosition([buy('50000', '0.1', '5'), sell('45000', '0.1', '4.5')], 'BTC');
  assert.equal(str(l.realised), '-509.5');
});

test('fees taken in the coin reduce what was received', () => {
  // buy 1 ETH at 3,000, fee 0.001 ETH (= 3 USDT) → hold 0.999; sell 0.999 at 3,300, fee 3.2967 USDT
  const p = replayPosition([
    buy('3000', '1', '3', { feeAsset: 'ETH', fee: '0.001' }),
    sell('3300', '0.999', '3.2967'),
  ], 'ETH');
  assert.equal(str(p.realised), '293.4033');   // 3,296.7 - 3.2967 - 3,000
  assert.equal(str(p.quantity), '0');
});

test('long-only: cannot sell more than held', () => {
  assert.throws(() => replayPosition([buy('100', '1'), sell('100', '2')], 'BTC'), /SELL_EXCEEDS_HOLDING/);
});

test('15% commission on profit only, never on capital (owner example: ₦100,000 profit)', () => {
  const c = commission({ cumulativeRealised: '100000', hwm: '0' });
  assert.deepEqual([c.commission, c.customerShare, c.eligible, c.newHwm], ['15000.00', '85000', '100000', '100000']);
  assert.equal(commission({ cumulativeRealised: '-500', hwm: '0' }).due, false);
  assert.equal(commission({ cumulativeRealised: '0', hwm: '0' }).commission, '0.00');
});

test('high-water mark: never charged twice, losses recovered first', () => {
  // charged on 1,000; then profit falls to 600 (loss 400) → nothing due
  assert.equal(commission({ cumulativeRealised: '600', hwm: '1000' }).due, false);
  // back to 1,000 → still nothing (only recovering)
  assert.equal(commission({ cumulativeRealised: '1000', hwm: '1000' }).due, false);
  // up to 1,500 → only the new 500 is eligible
  const c = commission({ cumulativeRealised: '1500', hwm: '1000' });
  assert.deepEqual([c.eligible, c.commission, c.previousHwm, c.newHwm], ['500', '75.00', '1000', '1500']);
});

test('commission rounds down to the cent', () => {
  const c = commission({ cumulativeRealised: '10.01', hwm: '0' });   // 15% = 1.5015
  assert.equal(c.commission, '1.50');
  assert.equal(c.customerShare, '8.51');
  assert.equal(commission({ cumulativeRealised: '0.05', hwm: '0' }).due, false);   // 0.0075 → 0.00, nothing to invoice
});

test('statement labels estimates and is reproducible from fills', () => {
  const pos = replayPosition([buy('50000', '0.1', '5'), sell('55000', '0.05', '2.75')], 'BTC');
  const s = statement({ startingCapital: '10000', exchangeBalance: '10247', positions: [{ ...pos, symbol: 'BTCUSDT' }], prices: { BTCUSDT: '56000' }, hwm: '0' });
  assert.equal(s.realisedNetProfit, '244.75');            // 2,750 - 2.75 fee - 2,502.5 cost (half of 5,005)
  assert.equal(s.unrealisedProfitEstimate, '297.5');      // 0.05 × 56,000 - 2,502.5
  assert.equal(s.commissionNow, '36.71');                 // 15% of 244.75 = 36.7125, rounded down
  assert.ok(s.notes.some((n) => n.includes('never holds')));
});
