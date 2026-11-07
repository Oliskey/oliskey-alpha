// Signal alerts when the app is closed, on the web (browsers and the installed web app). The phone apps need their own
// push setup, so they stay with in-app alerts for now.
import { Platform } from 'react-native';
import { api } from '@/lib/api';

export type PushState = 'unsupported' | 'install' | 'blocked' | 'off' | 'on';

const web = Platform.OS === 'web' && typeof window !== 'undefined';
const available = () => web && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const worker = () => Promise.race([
  navigator.serviceWorker.ready,
  new Promise<never>((_, reject) => { setTimeout(() => reject(new Error('Alerts are not ready yet. Reload the page and try again.')), 8000); }),
]);

const keyBytes = (key: string) => {
  const text = atob(key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '='));
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
};

export async function pushState(): Promise<PushState> {
  // iPhones only allow it once the app is on the home screen
  if (web && /iPhone|iPad|iPod/.test(navigator.userAgent) && !standalone()) return 'install';
  if (!available()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
}

export async function turnOnPush(): Promise<PushState> {
  if ((await Notification.requestPermission()) !== 'granted') return Notification.permission === 'denied' ? 'blocked' : 'off';
  const { key } = await api<{ key: string }>('/push/key');
  const reg = await worker();
  const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await api('/push/subscribe', { method: 'POST', body: { subscription: subscription.toJSON() } });
  return 'on';
}

export async function turnOffPush(): Promise<PushState> {
  if (!available()) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  }
  return 'off';
}
