// One shared WebSocket to the backend price stream, with auto-reconnect. Its state (connected or not) drives the
// offline screens: live prices and trading need this connection.
import { AppState } from 'react-native';
import { WS_URL } from './api';
import { PREVIEW } from './preview';

type Tick = { type: 'tick'; asset: string; price: number; ts: number };
type Momentum = { type: 'momentum'; asset: string; up: number };
export type ServerEvent = { type: 'trade_closed'; trade: any } | { type: 'trade_opened'; trade: any } | { type: 'task_completed'; taskId: string }
  | { type: 'order_update'; order: any; trade: any }
  | { type: 'notification'; alert?: { category: string; title: string; body: string | null; link: string | null; tone: 'up' | 'down' | 'neutral' } };

const tickListeners = new Map<string, Set<(t: Tick) => void>>();
const momentumListeners = new Map<string, Set<(m: Momentum) => void>>();
const eventListeners = new Set<(e: ServerEvent) => void>();

let socket: WebSocket | null = null;
let authToken: string | null = null;
let retry = 0;
let closedByUs = false;
let connected = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let lastMessageAt = 0;
let wasDown = false;
const statusListeners = new Set<() => void>();
const resumeListeners = new Set<() => void>();
const resumed = () => resumeListeners.forEach((fn) => fn());
/** Called when live data may have been missed: the connection came back, or the app came back to the screen. Charts reload their history. */
export function subscribeResume(fn: () => void) { resumeListeners.add(fn); return () => { resumeListeners.delete(fn); }; }

// Back on screen (phone unlocked, app or tab reopened). A phone that slept can leave the socket looking open while nothing arrives:
// if it has been silent, it is closed and reopened at once. Either way the charts reload what they missed.
function onScreenAgain() {
  if (PREVIEW || closedByUs) return;
  if (socket?.readyState === WebSocket.OPEN && Date.now() - lastMessageAt > 8000) {
    retry = 0;
    socket.close();   // onclose reconnects; onopen then calls resumed()
    return;
  }
  if (!socket) { if (retryTimer) clearTimeout(retryTimer); retry = 0; connect(); return; }
  resumed();
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onScreenAgain(); });
}
AppState.addEventListener?.('change', (s) => { if (s === 'active') onScreenAgain(); });
const setConnected = (v: boolean) => { if (v !== connected) { connected = v; statusListeners.forEach((fn) => fn()); } };
/** Live connection to the server (prices and trade updates). */
export const isStreamConnected = () => connected;
export function subscribeStreamStatus(fn: () => void) { statusListeners.add(fn); return () => { statusListeners.delete(fn); }; }
// back online: try at once instead of waiting for the next backoff step
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', () => {
    if (closedByUs) return;
    if (socket?.readyState === WebSocket.OPEN) { setConnected(true); onScreenAgain(); return; }
    if (!socket) { if (retryTimer) clearTimeout(retryTimer); retry = 0; connect(); }
  });
  // the device lost its network: a socket may linger half-open, so close it and reconnect cleanly when back
  window.addEventListener('offline', () => { setConnected(false); socket?.close(); });
}

function send(msg: object) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function connect() {
  if (PREVIEW) return;   // screens-only build: no server to connect to
  closedByUs = false;
  socket = new WebSocket(WS_URL);
  socket.onopen = () => {
    retry = 0;
    lastMessageAt = Date.now();
    setConnected(true);
    if (authToken) send({ type: 'auth', token: authToken });
    const assets = new Set([...tickListeners.keys(), ...momentumListeners.keys()]);
    for (const asset of assets) send({ type: 'subscribe', asset });
    if (wasDown) { wasDown = false; resumed(); }   // ticks were missed while it was closed
  };
  socket.onmessage = (e) => {
    lastMessageAt = Date.now();
    const msg = JSON.parse(String(e.data));
    if (msg.type === 'tick') tickListeners.get(msg.asset)?.forEach((fn) => fn(msg));
    else if (msg.type === 'momentum') momentumListeners.get(msg.asset)?.forEach((fn) => fn(msg));
    else if (msg.type === 'trade_closed' || msg.type === 'trade_opened' || msg.type === 'task_completed' || msg.type === 'order_update' || msg.type === 'notification') eventListeners.forEach((fn) => fn(msg));
  };
  socket.onclose = () => {
    socket = null;
    wasDown = true;
    setConnected(false);
    if (closedByUs) return;
    retryTimer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
  };
}

function ensure() {
  if (!socket) connect();
}

export function setStreamToken(token: string | null) {
  authToken = token;
  ensure();
  if (token) send({ type: 'auth', token });
}

function addListener<T>(map: Map<string, Set<T>>, asset: string, fn: T) {
  ensure();
  const isNew = !tickListeners.has(asset) && !momentumListeners.has(asset);
  if (!map.has(asset)) map.set(asset, new Set());
  map.get(asset)!.add(fn);
  if (isNew) send({ type: 'subscribe', asset });
  return () => {
    map.get(asset)?.delete(fn);
    if (!map.get(asset)?.size) map.delete(asset);
    if (!tickListeners.has(asset) && !momentumListeners.has(asset)) send({ type: 'unsubscribe', asset });
  };
}

export const subscribeTicks = (asset: string, fn: (t: Tick) => void) => addListener(tickListeners, asset, fn);
export const subscribeMomentum = (asset: string, fn: (m: Momentum) => void) => addListener(momentumListeners, asset, fn);

export function subscribeEvents(fn: (e: ServerEvent) => void) {
  ensure();
  eventListeners.add(fn);
  return () => {
    eventListeners.delete(fn);
  };
}

export function closeStream() {
  closedByUs = true;
  socket?.close();
  socket = null;
}
