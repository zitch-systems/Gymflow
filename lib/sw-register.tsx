'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    if (isLocal) return;
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((r) => {
        // Proactively check for a newer worker on load so a fresh deploy's SW
        // installs promptly. The VersionWatcher handles reloading the page onto
        // the new bundle; the SW just keeps the offline cache current.
        r.update().catch(() => {});
        console.log('[GF] SW:', r.scope);
      })
      .catch((e) => console.warn('[GF] SW skipped:', e.message));
  }, []);
  return null;
}
