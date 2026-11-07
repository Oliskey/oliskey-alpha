// Time-based one-time codes (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits), as used by
// Google Authenticator, Microsoft Authenticator, 1Password and similar apps.
import { createHmac, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SEC = 30;

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of str.replace(/=+$/, '').toUpperCase()) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newSecret = () => base32Encode(randomBytes(20));

export function codeAt(secret, step, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}

// Returns the matching step (current one, or one step either side for clock drift) if the code is valid
// and newer than lastStep, otherwise null. Callers store the step so a code can't be replayed.
export function verifyCode(secret, code, lastStep = 0, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code ?? ''))) return null;
  const current = Math.floor(now / 1000 / STEP_SEC);
  for (const step of [current - 1, current, current + 1]) {
    if (step > lastStep && codeAt(secret, step) === String(code)) return step;
  }
  return null;
}

export const otpauthUrl = (secret, email) =>
  `otpauth://totp/${encodeURIComponent(`Oliskey Alpha:${email}`)}?secret=${secret}&issuer=${encodeURIComponent('Oliskey Alpha')}`;
