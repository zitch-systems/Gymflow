// Self-unregistering service worker (kill-switch).
//
// An earlier build of GymFlow registered a service worker on this domain; the
// current app ships none. Browsers that still hold that registration keep
// re-requesting /sw.js — which 404'd and showed up in the console. Serving this
// file lets those browsers pick up an "update", which then unregisters the old
// worker, clears its caches, and reloads open tabs so they fetch fresh assets.
// New visitors never register it (nothing calls navigator.serviceWorker.register).
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        // best-effort cache purge
      }
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) client.navigate(client.url);
    })(),
  );
});
