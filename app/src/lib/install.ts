// "Download the app" on the web: the browser installs it to the home screen or desktop, and the service worker keeps every
// file, so it opens without internet. Live prices and trades still need the server (only the server prices and settles).
import { Platform } from 'react-native';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const web = Platform.OS === 'web' && typeof window !== 'undefined';
let waiting: InstallEvent | null = null;

/** Called once at start-up: adds the install details to the page and keeps the browser's install offer for later. */
export function prepareInstall() {
  if (!web) return;
  const add = (tag: string, attrs: Record<string, string>) => document.head.appendChild(Object.assign(document.createElement(tag), attrs));
  add('link', { rel: 'manifest', href: '/manifest.webmanifest' });
  add('link', { rel: 'apple-touch-icon', href: '/icon-512.png' });
  add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  add('meta', { name: 'apple-mobile-web-app-title', content: 'Oliskey Alpha' });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); waiting = e as InstallEvent; });
  window.addEventListener('appinstalled', () => { waiting = null; });
}

export const isInstalled = () => web && (matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** Opens the browser's install window. False when this browser only installs from its own menu. */
export async function askToInstall() {
  if (!waiting) return false;
  try {
    await waiting.prompt();
  } catch {
    return false;   // the browser refused its install window, so the caller shows the steps instead
  }
  await waiting.userChoice;
  waiting = null;
  return true;
}

/** The steps to show when the browser has no install window of its own. */
export function installSteps() {
  if (!web) return 'Install it from the app store when it is released.';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'In Safari, tap Share, then Add to Home Screen.';
  if (/Android/.test(ua)) return 'Open your browser menu, then tap Install app or Add to Home screen.';
  return 'Use the install icon at the end of the address bar, or your browser menu. This works in Chrome and Edge.';
}
