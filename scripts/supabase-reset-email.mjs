// Sets the hosted Supabase "Reset Password" email to carry the 6-digit code (owner decision 2026-11-08), through the Management API.
// Reads SUPABASE_ACCESS_TOKEN (a personal access token of the account that owns the project) from .env.local; never prints it.
// Reads the current auth settings first and changes only these five; everything else (Google, site address, other emails) stays.
//   node scripts/supabase-reset-email.mjs          shows what would change
//   node scripts/supabase-reset-email.mjs --apply  changes it, then reads it back to confirm
//   add --otp-only to change only the code length and expiry
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(([, k, v]) => [k, v.replace(/^"|"$/g, '')]));
const token = env.SUPABASE_ACCESS_TOKEN;
const ref = (env.HOSTED_SUPABASE_URL || env.SUPABASE_URL || 'https://neodvdmjhsviosuxhpkd.supabase.co').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!token) { console.log('No SUPABASE_ACCESS_TOKEN in .env.local yet.'); process.exit(1); }

const ALL = {
  mailer_otp_length: 6,
  mailer_otp_exp: 300,
  mailer_subjects_recovery: 'Your Oliskey Alpha reset code',
  mailer_templates_recovery_content: `<h2>Reset your Oliskey Alpha password</h2>
<p>Your code is:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
<p>Type it in the app with your new password. It works for 5 minutes.</p>
<p>If you did not ask for this, ignore this email. Your password stays the same.</p>`,
};

// --otp-only: just the code length and expiry. Free projects on Supabase's built-in email sender cannot change the email text;
// that needs a custom SMTP sender (Authentication > Emails > SMTP settings) first.
const WANT = process.argv.includes('--otp-only') ? { mailer_otp_length: ALL.mailer_otp_length, mailer_otp_exp: ALL.mailer_otp_exp } : ALL;

const api = async (method, body) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) { console.log(`Supabase answered ${r.status} for project ${ref}: ${(await r.text()).slice(0, 200)}`); process.exit(1); }
  return r.json();
};

const now = await api('GET');
console.log(`Project ${ref}`);
for (const [k, v] of Object.entries(WANT)) {
  const same = String(now[k] ?? '') === String(v);
  console.log(`${same ? 'same   ' : 'change '} ${k}: ${JSON.stringify(String(now[k] ?? '')).slice(0, 70)}${same ? '' : `  ->  ${JSON.stringify(String(v)).slice(0, 70)}`}`);
}
if (!process.argv.includes('--apply')) process.exit(0);
await api('PATCH', WANT);
const after = await api('GET');
const bad = Object.keys(WANT).filter((k) => String(after[k]) !== String(WANT[k]));
console.log(bad.length ? `NOT CONFIRMED: ${bad.join(', ')}` : `CONFIRMED: ${Object.keys(WANT).join(', ')}`);
console.log(`code in the email: ${String(after.mailer_templates_recovery_content).includes('{{ .Token }}') ? 'yes' : 'not yet (the email still sends a link)'}`);
