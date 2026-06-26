// GymFlow service worker — speeds up repeat loads and gives an offline shell.
//
// Strategy:
//  - Static assets (/_next/static, /images, fonts): stale-while-revalidate
//    (serve from cache instantly, refresh in the background).
//  - Page navigations: network-first with a cache fallback, then an offline
//    page when truly offline.
//  - Everything else (cross-origin, non-GET, the Supabase API, Paystack):
//    not intercepted — always hits the network.
const VERSION = 'gf-v1';
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGE_CACHE);
      try { await cache.add(OFFLINE_URL); } catch { /* offline page optional */ }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

const isStatic = (url) =>
  url.pathname.startsWith('/_next/static/') ||
  url.pathname.startsWith('/images/') ||
  /\.(?:js|css|woff2?|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch Supabase/Paystack/etc.

  // Static assets → stale-while-revalidate.
  if (isStatic(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        const network = fetch(request).then((res) => {
          if (res && res.ok) cache.put(request, res.clone());
          return res;
        }).catch(() => cached);
        return cached || network;
      })(),
    );
    return;
  }

  // Page navigations → network-first, fall back to cache, then offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          const cache = await caches.open(PAGE_CACHE);
          cache.put(request, res.clone());
          return res;
        } catch {
          const cache = await caches.open(PAGE_CACHE);
          const cached = await cache.match(request);
          return cached || (await cache.match(OFFLINE_URL)) || Response.error();
        }
      })(),
    );
  }
});
