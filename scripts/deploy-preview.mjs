// Publishes the screens-only preview to Vercel. Only the built web files are uploaded, never source code or .env files.
// The bundle has no server address: sign-in and trading stay off (app/src/lib/preview.ts).
//   npm run deploy:preview
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeOfflineList } from './offline-list.mjs';
import { applySeo } from './seo.mjs';

const app = path.resolve(import.meta.dirname, '../app');
const out = path.join(app, 'dist-preview');
const keep = mkdtempSync(path.join(tmpdir(), 'oliskey-vercel-'));
const link = path.join(out, '.vercel');
if (existsSync(link)) cpSync(link, path.join(keep, '.vercel'), { recursive: true });

const env = { ...process.env, EXPO_PUBLIC_PREVIEW: '1', EXPO_PUBLIC_API_URL: 'https://preview.invalid', EXPO_PUBLIC_WS_URL: 'wss://preview.invalid/stream' };
execSync('npx expo export -p web --output-dir dist-preview', { cwd: app, env, stdio: 'inherit' });

if (existsSync(path.join(keep, '.vercel'))) cpSync(path.join(keep, '.vercel'), link, { recursive: true });
rmSync(keep, { recursive: true, force: true });
applySeo(out);
writeOfflineList(out);
// On Vercel's own build (a push to GitHub) only the files are needed: vercel.json at the repo root does the rest.
if (process.env.VERCEL) process.exit(0);
writeFileSync(path.join(out, 'vercel.json'), JSON.stringify({
  rewrites: [{ source: '/(.*)', destination: '/index.html' }],
  headers: [{ source: '/(.*)', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
  ] }],
}, null, 2));

const scope = process.env.VERCEL_SCOPE ? ` --scope ${process.env.VERCEL_SCOPE}` : '';
// first run: create and link the project under its proper name (later runs reuse the saved link)
if (!existsSync(link)) {
  try { execSync(`vercel project add oliskey-alpha${scope}`, { cwd: out, stdio: 'inherit' }); } catch { /* already exists */ }
  execSync(`vercel link --yes --project oliskey-alpha${scope}`, { cwd: out, stdio: 'inherit' });
}
execSync(`vercel deploy --prod --yes${scope}`, { cwd: out, stdio: 'inherit' });
