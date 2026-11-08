// Session token storage: SecureStore on Android/iOS, localStorage on web (SecureStore has no web support).
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'oliskey-alpha.session';

export async function loadToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return localStorage.getItem(KEY); } catch { return null; }
  }
  return SecureStore.getItemAsync(KEY);
}

export async function saveToken(token: string | null) {
  if (Platform.OS === 'web') {
    try { if (token) localStorage.setItem(KEY, token); else localStorage.removeItem(KEY); } catch {}
    return;
  }
  if (token) await SecureStore.setItemAsync(KEY, token);
  else await SecureStore.deleteItemAsync(KEY);
}

// Small preferences (theme, chart, favourites, tips seen). Saved on this device first, so they work offline, and the ones in SYNCED
// are also sent to the account (owner decision 2026-11-08), so they follow the person to every phone and computer they sign in on.
// The list matches SETTING_NAMES in backend/src/routes/account.js.
export const SYNCED = ['theme', 'chart', 'indicators', 'drawPrefs', 'drawings', 'assetTabs', 'favorites', 'tradePanelOpen', 'tip-ai', 'signalsSeen'];

let pusher: ((name: string, value: string) => Promise<unknown>) | null = null;
const waiting = new Map<string, string>();     // saved here, not yet on the account (offline, or written quickly in a row)
let timer: ReturnType<typeof setTimeout> | null = null;
const pulledListeners = new Set<() => void>();

function sendSoon(delay = 800) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    if (!pusher) return;
    for (const [name, value] of [...waiting]) {
      try { await pusher(name, value); if (waiting.get(name) === value) waiting.delete(name); }
      catch { sendSoon(30_000); return; }   // offline or the server is away: try again later; this device keeps its copy
    }
  }, delay);
}

/** Signed in: settings changed on this device go to the account. Signed out (null): they stay here only. */
export function setPrefPusher(fn: typeof pusher) {
  pusher = fn;
  if (!fn) { waiting.clear(); if (timer) clearTimeout(timer); timer = null; }
  else if (waiting.size) sendSoon();
}

/** The account's settings, just fetched: written to this device, then screens already open re-read the ones they show. */
export async function applyPulledPrefs(prefs: Record<string, unknown>) {
  for (const name of SYNCED) {
    const v = prefs[name];
    if (typeof v === 'string' && !waiting.has(name)) await writeLocal(name, v).catch(() => {});   // one that cannot be stored here is skipped
  }
  pulledListeners.forEach((fn) => fn());
}

export function onPrefsPulled(fn: () => void) { pulledListeners.add(fn); return () => { pulledListeners.delete(fn); }; }

/** Signing out: this person's settings leave the device, so the next person here starts with their own. The theme stays. */
export async function clearSyncedPrefs() {
  for (const name of SYNCED) if (name !== 'theme') await removeLocal(name);
  pulledListeners.forEach((fn) => fn());
}

async function writeLocal(name: string, value: string) {
  const key = `oliskey-alpha.${name}`;
  if (Platform.OS === 'web') { try { localStorage.setItem(key, value); } catch {} return; }
  await SecureStore.setItemAsync(key, value);
}

async function removeLocal(name: string) {
  const key = `oliskey-alpha.${name}`;
  if (Platform.OS === 'web') { try { localStorage.removeItem(key); } catch {} return; }
  await SecureStore.deleteItemAsync(key);
}

export async function getPref(name: string): Promise<string | null> {
  const key = `oliskey-alpha.${name}`;
  if (Platform.OS === 'web') {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  return SecureStore.getItemAsync(key);
}

export async function setPref(name: string, value: string) {
  await writeLocal(name, value);
  if (SYNCED.includes(name)) { waiting.set(name, value); if (pusher) sendSoon(); }
}
