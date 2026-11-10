// Live feeds go through liveUpdate (lib/liveBatch): applied one by one they keep restarting a page that is being built.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { liveUpdate } from '@/lib/liveBatch';
import { useQuery } from '@tanstack/react-query';
import { api, type Asset, type Candle } from '@/lib/api';
import { subscribeMomentum, subscribeResume, subscribeTicks } from '@/lib/ws';

export function useAssets() {
  const q = useQuery({ queryKey: ['assets'], queryFn: () => api<Asset[]>('/assets'), staleTime: 60_000 });
  const byId = useMemo(() => new Map((q.data ?? []).map((a) => [a.id, a])), [q.data]);
  return { assets: q.data ?? [], byId, loading: q.isLoading };
}

// Live price for one asset (null until the first tick).
export function useLivePrice(assetId: string | undefined) {
  const [price, setPrice] = useState<number | null>(null);
  useEffect(() => {
    if (!assetId) return;
    setPrice(null);
    return subscribeTicks(assetId, (t) => liveUpdate(() => setPrice(t.price), setPrice));
  }, [assetId]);
  return price;
}

// Latest prices for many assets (asset lists). Updates at most every 500 ms to keep lists cheap.
export function useLivePrices(ids: string[]) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const key = ids.join(',');
  useEffect(() => {
    const pending: Record<string, number> = {};
    const unsubs = ids.map((id) => subscribeTicks(id, (t) => { pending[id] = t.price; }));
    const timer = setInterval(() => {
      if (Object.keys(pending).length) liveUpdate(() => setPrices((p) => ({ ...p, ...pending })), setPrices);
    }, 500);
    return () => { unsubs.forEach((u) => u()); clearInterval(timer); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return prices;
}

export function useMomentum(assetId: string) {
  const [up, setUp] = useState(50);
  useEffect(() => subscribeMomentum(assetId, (m) => liveUpdate(() => setUp(m.up), setUp)), [assetId]);
  return up;
}

// The last candles of each market are kept, so the chart still shows when the connection drops (owner 2026-11-08: see the chart offline).
// In memory on every device; on web also in the browser, so it shows when the app is opened offline. A few markets, a few hundred candles each.
const KEEP_CANDLES = 300, KEEP_MARKETS = 12, SAVE_EVERY_MS = 20_000;
const kept = new Map<string, Candle[]>();
const savedAt = new Map<string, number>();
const storeKey = (k: string) => `oliskey-alpha.candles.${k}`;
const webStore = () => { try { return Platform.OS === 'web' && typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

function keptCandles(k: string): Candle[] {
  const mem = kept.get(k);
  if (mem) return mem;
  try {
    const v = JSON.parse(webStore()?.getItem(storeKey(k)) ?? 'null');
    if (Array.isArray(v) && v.every((c) => c && typeof c.time === 'number' && typeof c.close === 'number')) return v as Candle[];
  } catch { /* bad or no saved copy */ }
  return [];
}

function keepCandles(k: string, list: Candle[], force = false) {
  const now = Date.now();
  if (!list.length) return;
  kept.set(k, list);
  if (kept.size > KEEP_MARKETS) kept.delete(kept.keys().next().value as string);
  const store = webStore();
  if (!store || (!force && now - (savedAt.get(k) ?? 0) < SAVE_EVERY_MS)) return;
  savedAt.set(k, now);
  try {
    store.setItem(storeKey(k), JSON.stringify(list.slice(-KEEP_CANDLES)));
    const index: string[] = JSON.parse(store.getItem('oliskey-alpha.candles') ?? '[]');
    const next = [k, ...index.filter((x) => x !== k)];
    for (const old of next.slice(KEEP_MARKETS)) store.removeItem(storeKey(old));
    store.setItem('oliskey-alpha.candles', JSON.stringify(next.slice(0, KEEP_MARKETS)));
  } catch { /* storage full or blocked: the memory copy still works */ }
}

// Candles from the server, then kept live from the tick stream (only the last candle changes per tick).
export function useLiveCandles(assetId: string, tf: number, count = 120) {
  const q = useQuery({
    queryKey: ['candles', assetId, tf],
    queryFn: () => api<Candle[]>(`/candles/${assetId}?tf=${tf}&count=${count}`),
    staleTime: Infinity,
    gcTime: 0,
  });
  // Each list remembers whose candles it holds. Live updates wait in a queue (up to about a second), so after a switch of market or
  // timeframe an old market's tick could land on the new market's last candle: one 113 tick on a 5.20 market stretched the scale
  // until every real candle was a flat line. An update for another market or timeframe is dropped, and old candles are never shown.
  const key = `${assetId}|${tf}`;
  const [held, setHeld] = useState<{ key: string; list: Candle[] }>(() => ({ key, list: keptCandles(key) }));
  const [last, setLast] = useState<{ price: number; ts: number; key: string } | null>(null);

  // fresh candles from the server; until they arrive (or with no connection) the kept ones for this market
  useEffect(() => {
    if (q.data) { setHeld({ key, list: q.data }); keepCandles(key, q.data, true); }
    else setHeld((h) => (h.key === key ? h : { key, list: keptCandles(key) }));
  }, [q.data, key]);
  useEffect(() => { if (held.key === key) keepCandles(key, held.list); }, [held, key]);

  // Missed time: candles are built from live ticks, so minutes without ticks (phone asleep, data off, app in the background) would stay
  // missing until the market was switched. The history is reloaded from the server when the connection or the screen comes back, and when
  // a tick lands more than one candle after the last one. At most once every 5 s.
  const lastTime = useRef(0);
  lastTime.current = held.key === key ? held.list[held.list.length - 1]?.time ?? 0 : 0;
  const reloadedAt = useRef(0);
  const refetch = q.refetch;
  const reload = useRef(() => {});
  reload.current = () => {
    if (Date.now() - reloadedAt.current < 5000) return;
    reloadedAt.current = Date.now();
    void refetch();
  };
  useEffect(() => subscribeResume(() => reload.current()), []);

  useEffect(() => subscribeTicks(assetId, (t) => {
    if (lastTime.current && Math.floor(t.ts / (tf * 1000)) * tf * 1000 > lastTime.current + tf * 1000) reload.current();
    liveUpdate(() => setLast({ price: t.price, ts: t.ts, key }), setLast);
    liveUpdate(() => setHeld((h) => {
      if (h.key !== key) return h;
      const cs = h.list;
      if (!cs.length) return h;
      const bucket = Math.floor(t.ts / (tf * 1000)) * tf * 1000;
      const lastC = cs[cs.length - 1];
      if (bucket === lastC.time) {
        const next = cs.slice();
        next[next.length - 1] = { ...lastC, high: Math.max(lastC.high, t.price), low: Math.min(lastC.low, t.price), close: t.price };
        return { key, list: next };
      }
      if (bucket < lastC.time) return h;
      const next = cs.length >= count ? cs.slice(1) : cs.slice();
      next.push({ time: bucket, open: t.price, high: t.price, low: t.price, close: t.price });
      return { key, list: next };
    }));
  }), [assetId, tf, count, key]);

  const candles = useMemo(() => (held.key === key ? held.list : []), [held, key]);
  const live = useMemo(() => (last && last.key === key ? { price: last.price, ts: last.ts } : null), [last, key]);
  // saved: the chart is the kept copy, not yet refreshed from the server (offline, or still loading)
  return { candles, last: live, loading: q.isLoading || held.key !== key, saved: !q.data && candles.length > 0 };
}
