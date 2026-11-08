// Live feeds go through liveUpdate (lib/liveBatch): applied one by one they keep restarting a page that is being built.
import { useEffect, useMemo, useState } from 'react';
import { liveUpdate } from '@/lib/liveBatch';
import { useQuery } from '@tanstack/react-query';
import { api, type Asset, type Candle } from '@/lib/api';
import { subscribeMomentum, subscribeTicks } from '@/lib/ws';

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
  const [held, setHeld] = useState<{ key: string; list: Candle[] }>({ key, list: [] });
  const [last, setLast] = useState<{ price: number; ts: number; key: string } | null>(null);

  useEffect(() => { if (q.data) setHeld({ key, list: q.data }); }, [q.data, key]);

  useEffect(() => subscribeTicks(assetId, (t) => {
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
  return { candles, last: live, loading: q.isLoading || held.key !== key };
}
