// Is the app connected to the server right now? 'online' when the live price stream is open, 'offline' when the
// device has no network, 'connecting' while it is (re)connecting. Screens use it to pause trading, never to log out.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { PREVIEW } from '@/lib/preview';
import { isStreamConnected, subscribeStreamStatus } from '@/lib/ws';

export type Connection = 'online' | 'connecting' | 'offline' | 'preview';

const deviceOnline = () => (Platform.OS === 'web' && typeof navigator !== 'undefined' ? navigator.onLine !== false : true);

export function useConnection(): Connection {
  const live = useSyncExternalStore(subscribeStreamStatus, isStreamConnected, isStreamConnected);
  const [net, setNet] = useState(deviceOnline);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const on = () => setNet(true), off = () => setNet(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  // give the first connection a moment before showing anything
  const [settled, setSettled] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSettled(true), 2500); return () => clearTimeout(t); }, []);
  if (PREVIEW) return 'preview';
  if (!net) return 'offline';
  if (live) return 'online';
  return settled ? 'connecting' : 'online';
}
