// Puts a finished web build live in one step: app/dist-next -> app/dist. The build writes to dist-next first, so the
// running server keeps serving the old app until the new one is complete (no broken pages during a rebuild).
import { existsSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { writeOfflineList } from './offline-list.mjs';
import { applySeo } from './seo.mjs';

const app = path.resolve(import.meta.dirname, '../app');
const next = path.join(app, 'dist-next'), live = path.join(app, 'dist'), old = path.join(app, 'dist-old');
if (!existsSync(path.join(next, 'index.html'))) { console.error('No finished build in app/dist-next'); process.exit(1); }
applySeo(next);
writeOfflineList(next);

// Windows (and OneDrive) can hold a file for a moment while it is being served or synced: retry briefly.
const retry = (fn) => {
  for (let i = 0; ; i++) {
    try { return fn(); } catch (e) {
      if (i >= 20 || !['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
};
if (existsSync(old)) retry(() => rmSync(old, { recursive: true, force: true }));
if (existsSync(live)) retry(() => renameSync(live, old));
retry(() => renameSync(next, live));
retry(() => rmSync(old, { recursive: true, force: true }));
console.log('Web build is live (app/dist)');
