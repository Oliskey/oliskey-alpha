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
  const [candles, setCandles] = useState<Candle[]>([]);
  const [last, setLast] = useState<{ price: number; ts: number } | null>(null);

  useEffect(() => { if (q.data) setCandles(q.data); }, [q.data]);

  useEffect(() => subscribeTicks(assetId, (t) => {
    liveUpdate(() => setLast({ price: t.price, ts: t.ts }), setLast);
    liveUpdate(() => setCandles((cs) => {
      if (!cs.length) return cs;
      const bucket = Math.floor(t.ts / (tf * 1000)) * tf * 1000;
      const lastC = cs[cs.length - 1];
      if (bucket === lastC.time) {
        const next = cs.slice();
        next[next.length - 1] = { ...lastC, high: Math.max(lastC.high, t.price), low: Math.min(lastC.low, t.price), close: t.price };
        return next;
      }
      if (bucket < lastC.time) return cs;
      const next = cs.length >= count ? cs.slice(1) : cs.slice();
      next.push({ time: bucket, open: t.price, high: t.price, low: t.price, close: t.price });
      return next;
    }));
  }), [assetId, tf, count]);

  return { candles, last, loading: q.isLoading };
}
