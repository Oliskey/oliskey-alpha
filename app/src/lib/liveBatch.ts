// Every live update (prices, candles, momentum, running clocks) goes through here. They are collected and applied together, a few
// times a second, when the browser has a free moment, so the screen redraws once for many updates rather than once for each.
import { startTransition } from 'react';

const FLUSH_MS = 200;       // at most this often
const WAIT_IDLE_MS = 1000;  // and never held longer than this, so a busy page still moves

const keyed = new Map<unknown, () => void>();   // only the latest matters: a price, a clock
let ordered: (() => void)[] = [];               // each one matters: candle highs and lows are built from every tick
let waiting = false;

type IdleWindow = { requestIdleCallback?: (fn: () => void, opts: { timeout: number }) => number };

function flush() {
  waiting = false;
  const run = [...ordered, ...keyed.values()];
  ordered = [];
  keyed.clear();
  startTransition(() => { for (const fn of run) fn(); });
}

function schedule() {
  if (waiting) return;
  waiting = true;
  setTimeout(() => {
    const idle = typeof window !== 'undefined' ? (window as unknown as IdleWindow).requestIdleCallback : undefined;
    if (idle) idle.call(window, flush, { timeout: WAIT_IDLE_MS });
    else flush();
  }, FLUSH_MS);
}

/** Applies a live update soon. With a key, a newer update with the same key replaces an older one still waiting. */
export function liveUpdate(fn: () => void, key?: unknown) {
  if (key !== undefined) keyed.set(key, fn);
  else ordered.push(fn);
  schedule();
}
