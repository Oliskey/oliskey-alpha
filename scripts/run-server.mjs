// Keeps the backend running: `npm start` runs this. It brings the backend back if it stops, and restarts it when the restart file appears,
// so a code update never needs anyone at the keyboard. Open trades reload from the database when the backend starts.
//   ask for a restart: create %LOCALAPPDATA%\oliskey-alpha\restart-server (any content)
import { fork } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const BACKEND = path.resolve(import.meta.dirname, '../backend');
const FOLDER = path.join(process.env.LOCALAPPDATA || process.cwd(), 'oliskey-alpha');
const FLAG = path.join(FOLDER, 'restart-server');
const CHECK_MS = 3_000;
const BACK_AFTER_MS = 3_000;
const GIVE_UP_WAITING_MS = 8_000;
const QUICK_CRASH_MS = 30_000;     // stopped this soon after starting: something is wrong, so wait longer before the next try
const AFTER_QUICK_CRASH_MS = 30_000;

mkdirSync(FOLDER, { recursive: true });
rmSync(FLAG, { force: true });     // a request left from before this start is already satisfied

let child = null;
let stopping = false;

function start() {
  const at = Date.now();
  child = fork('src/server.js', { cwd: BACKEND, stdio: 'inherit' });
  child.on('exit', (code) => {
    child = null;
    if (stopping) process.exit(0);
    const wait = Date.now() - at < QUICK_CRASH_MS ? AFTER_QUICK_CRASH_MS : BACK_AFTER_MS;
    console.warn(`Backend stopped (code ${code}); starting it again in ${wait / 1000} s`);
    setTimeout(start, wait);
  });
}

// The backend closes itself so its price snapshot is saved and the engine it started goes with it. Forced only if it does not answer.
function ask() {
  const running = child;
  if (!running) return;
  running.send('shutdown');
  setTimeout(() => { if (child === running) running.kill(); }, GIVE_UP_WAITING_MS);
}

setInterval(() => {
  if (!existsSync(FLAG)) return;
  rmSync(FLAG, { force: true });
  console.log('Restart requested: restarting the backend');
  ask();
}, CHECK_MS);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    if (child) ask();
    else process.exit(0);
  });
}

start();
