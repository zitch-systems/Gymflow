// GymFlow Service Worker v6 — Next.js App Router
const VERSION = 'gymflow-v6';
const STATIC_CACHE = VERSION + '-static';
const RUNTIME_CACHE = VERSION + '-runtime';

// Static assets that ship with every build live under /_next/static — these
// are content-hashed, so they're safe to cache aggressively as runtime entries.
// We pre-cache only the offline shell and manifest at install time.
const CORE_ASSETS = ['/', '/offline', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        Promise.all(CORE_ASSETS.map((u) => cache.add(u).catch(() => null))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Never cache 3rd-party APIs / fonts
  const urlStr = req.url;
  if (
    urlStr.includes('supabase.co') ||
    urlStr.includes('fonts.googleapis.com') ||
    urlStr.includes('fonts.gstatic.com') ||
    urlStr.includes('paystack.co')
  ) {
    return; // Let browser handle directly
  }

  const url = new URL(urlStr);
  if (url.origin !== location.origin) return;

  // Never cache Next.js Server Action / data calls
  if (url.pathname.startsWith('/api/')) return;
  if (url.searchParams.has('_rsc')) return;

  const accept = req.headers.get('accept') || '';

  // Navigation: network-first with offline fallback.
  // CRITICAL: never cache authenticated HTML — a cached /dashboard or /admin
  // page can be replayed for a different user on a shared device (gym front
  // desk) or after logout. Only public marketing routes are runtime-cacheable.
  if (req.mode === 'navigate' || accept.includes('text/html')) {
    const isAuthRoute =
      /^\/(?:dashboard|admin|coach|superadmin|checkin|classes|cards|join|login|signup)(?:\/|$)/.test(url.pathname) ||
      url.pathname.startsWith('/gym/');
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !isAuthRoute) {
            const clone = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => {
          if (isAuthRoute) return caches.match('/offline');
          return caches.match(req).then((r) => r || caches.match('/offline'));
        }),
    );
    return;
  }

  // Static assets (incl. /_next/static): cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const clone = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => {
          if (req.destination === 'image') {
            return new Response(
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="#1e293b" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="#64748b" font-size="10">offline</text></svg>',
              { headers: { 'Content-Type': 'image/svg+xml' } },
            );
          }
          return new Response('', { status: 504 });
        });
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// ── Web Push ──────────────────────────────────────────────────────────────
// Payload shape (set by lib/web-push.ts): { title, body, url, tag }.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'GymFlow', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'GymFlow';
  const options = {
    body: data.body || '',
    tag: data.tag || undefined,
    // Collapse same-tag notifications but still alert on the newer one.
    renotify: !!data.tag,
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus an existing tab on the target URL if one is open, else open a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          const url = new URL(client.url);
          if (url.pathname === target || client.url.endsWith(target)) return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
