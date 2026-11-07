// Writes offline-files.json into a finished web build: every file the service worker should save for offline use.
//   node scripts/offline-list.mjs <build folder>
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function writeOfflineList(dir) {
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name);
      if (name === '.vercel') continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|css|png|jpg|jpeg|svg|ico|ttf|woff2?)$/.test(name) && name !== 'sw.js') files.push(`/${path.relative(dir, full).split(path.sep).join('/')}`);
    }
  };
  walk(dir);
  writeFileSync(path.join(dir, 'offline-files.json'), JSON.stringify(files));
  return files.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  console.log('offline list:', writeOfflineList(path.resolve(process.argv[2])), 'files');
}
