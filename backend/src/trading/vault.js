// Encryption for customers' exchange API credentials (AES-256-GCM).
// Keys come from the server's secret settings, never from code or the database:
//   TRADING_CREDENTIALS_KEYS   = "k1:<base64 32 bytes>,k2:<base64 32 bytes>"   (old keys stay listed so old rows decrypt)
//   TRADING_CREDENTIALS_ACTIVE = "k2"                                          (new rows use this key)
// Each ciphertext is bound to its owner, exchange and environment (additional authenticated data), so a row copied to
// another customer cannot be decrypted. Plain credentials exist only in memory for the length of an exchange call and
// are never logged, returned by the API or stored in the browser. Rotation: add a key, make it active, run reencrypt().
// For production, a managed key service (Supabase Vault or a cloud KMS) can supply these keys.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function keys(env = process.env) {
  const map = new Map();
  for (const part of String(env.TRADING_CREDENTIALS_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [id, b64] = part.split(':');
    const key = Buffer.from(b64 || '', 'base64');
    if (!/^[a-z0-9]{1,16}$/i.test(id || '') || key.length !== 32) throw new Error('TRADING_CREDENTIALS_KEYS is malformed');
    map.set(id, key);
  }
  return map;
}

export function vaultConfigured(env = process.env) {
  try { const k = keys(env); return k.has(env.TRADING_CREDENTIALS_ACTIVE); } catch { return false; }
}

const aad = ({ userId, providerId, environment }) => Buffer.from(`oliskey-trading|${userId}|${providerId}|${environment}`);

/** Encrypt { apiKey, apiSecret, passphrase? } → { ciphertext, keyId }. */
export function seal(credentials, owner, env = process.env) {
  const map = keys(env), keyId = env.TRADING_CREDENTIALS_ACTIVE;
  const key = map.get(keyId);
  if (!key) throw new Error('VAULT_NOT_CONFIGURED');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(aad(owner));
  const body = Buffer.concat([c.update(JSON.stringify({ k: credentials.apiKey, s: credentials.apiSecret, p: credentials.passphrase || null }), 'utf8'), c.final()]);
  return { ciphertext: ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join('.'), keyId };
}

/** Decrypt a stored row back to { apiKey, apiSecret, passphrase }. Throws if the row was tampered with or moved. */
export function open({ ciphertext, keyId }, owner, env = process.env) {
  const key = keys(env).get(keyId);
  if (!key) throw new Error('VAULT_KEY_MISSING');
  const [v, iv, tag, body] = String(ciphertext).split('.');
  if (v !== 'v1') throw new Error('VAULT_FORMAT');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64')); d.setAAD(aad(owner)); d.setAuthTag(Buffer.from(tag, 'base64'));
  const o = JSON.parse(Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8'));
  return { apiKey: o.k, apiSecret: o.s, passphrase: o.p || undefined };
}

/** Re-encrypt with the active key (rotation). */
export const reencrypt = (row, owner, env = process.env) => seal(open(row, owner, env), owner, env);

/** What may be shown about a key: its last 4 characters. */
export const keyHint = (apiKey) => '…' + String(apiKey).slice(-4);
