// Minimal Paystack client (https://paystack.com/docs/api/). Amounts are sent in kobo.
import { createHmac, timingSafeEqual } from 'node:crypto';

const BASE = 'https://api.paystack.co';

export const paystackConfigured = () => Boolean(process.env.PAYSTACK_SECRET_KEY);

export async function paystack(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false) throw new Error(`Paystack ${path}: ${json.message || res.status}`);
  return json.data;
}

// x-paystack-signature = HMAC-SHA512 of the raw request body with the secret key (hex).
export function validSignature(rawBody, signature, secret = process.env.PAYSTACK_SECRET_KEY) {
  if (!secret || !rawBody || typeof signature !== 'string') return false;
  const expected = Buffer.from(createHmac('sha512', secret).update(rawBody).digest('hex'));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const toKobo = (naira) => Math.round(Number(naira) * 100);
