// Oliskey Alpha service worker: keeps every file of the app, so once it has loaded or been installed it opens without
// internet, and shows signal alerts while the app is closed.
//  - installing: saves all built files listed in offline-files.json (written by the build)
//  - page loads: network first, the saved app when offline
//  - built files (/_expo, /assets, fonts, images): served from the saved copy, saved on first use if missing
//  - everything else (API calls, prices, trades) goes straight to the network and is never saved
const CACHE = 'oliskey-alpha-app-v2';
const SHELL = '/';
const STATIC = /^\/(_expo|assets)\/|\.(js|css|png|jpg|jpeg|svg|ico|ttf|woff2?)$/;

async function saveAll() {
  const cache = await caches.open(CACHE);
  try {
    const files = await (await fetch('/offline-files.json', { cache: 'no-store' })).json();
    // a few at a time; one failed file must not stop the rest
    for (let i = 0; i < files.length; i += 6) {
      const batch = [];
      for (const f of files.slice(i, i + 6)) if (!(await cache.match(f))) batch.push(cache.add(f));
      await Promise.allSettled(batch);
    }
  } catch { /* no list: files are still saved as they are used */ }
}

// Ready at once with just the page, then the rest is saved in the background: a slow connection never holds the app back.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(SHELL, { headers: { Accept: 'text/html' } }))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()).then(saveAll));
});
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { /* an alert with no details still shows */ }
  e.waitUntil(self.registration.showNotification(d.title || 'Oliskey Alpha', { body: d.body || '', icon: '/icon-512.png', badge: '/icon-512.png', data: { link: d.link } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = e.notification.data?.link;
  const path = typeof link === 'string' && link.startsWith('/') && !link.startsWith('//') ? link : '/';   // only ever opens this app
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
    const open = all.find((c) => 'navigate' in c);
    return open ? open.navigate(path).then((c) => (c || open).focus()) : self.clients.openWindow(path);
  }));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(SHELL, copy)); }
      return res;
    }).catch(() => caches.match(SHELL)));
    return;
  }
  if (STATIC.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
