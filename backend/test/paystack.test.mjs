import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { toKobo, validSignature } from '../src/paystack.js';

test('webhook signature: valid accepted, forged/missing rejected', () => {
  const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'OA-1' } }));
  const sig = createHmac('sha512', 'sk_test_x').update(body).digest('hex');
  assert.equal(validSignature(body, sig, 'sk_test_x'), true);
  assert.equal(validSignature(body, sig, 'sk_test_other'), false);
  assert.equal(validSignature(Buffer.from(body.toString() + ' '), sig, 'sk_test_x'), false, 'tampered body');
  assert.equal(validSignature(body, undefined, 'sk_test_x'), false);
  assert.equal(validSignature(body, sig, ''), false, 'no secret configured');
});

test('naira to kobo', () => {
  assert.equal(toKobo(5000), 500000);
  assert.equal(toKobo('1234.56'), 123456);
});
