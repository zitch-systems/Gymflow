// GymFlow Service Worker v3 — improved caching, offline support, fixed paths
const VERSION = 'gymflow-v3';
const STATIC_CACHE = VERSION + '-static';
const RUNTIME_CACHE = VERSION + '-runtime';

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/join.html',
  '/offline.html',
  '/manifest.json',
  '/gymflow.css',
  '/tailwind_built.css',
  '/gymflow-extra.css',
  '/gf-utils.js',
  '/pwa-install.js',
  '/supabase-config.js',
  '/supabase.js',
  '/js/supabase-config.js',
  '/js/supabase.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => Promise.all(CORE_ASSETS.map(u => cache.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/v1/')) return;

  const accept = req.headers.get('accept') || '';

  // HTML: network-first with offline fallback
  if (accept.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(RUNTIME_CACHE).then(c => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('/offline.html')))
    );
    return;
  }

  // Other assets: cache-first
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req)
        .then(res => {
          if (res.ok && res.type === 'basic') {
            const clone = res.clone();
            caches.open(RUNTIME_CACHE).then(c => c.put(req, clone));
          }
          return res;
        })
        .catch(() => {
          if (req.destination === 'image') {
            return new Response(
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="#1e293b" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="#64748b" font-size="10">offline</text></svg>',
              { headers: { 'Content-Type': 'image/svg+xml' } }
            );
          }
          return new Response('', { status: 504 });
        });
    })
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
