'use client';

import { useEffect } from 'react';

// Registers the service worker (production only) after the page has loaded, so
// it never competes with the initial render. The SW caches static assets for
// fast repeat loads and provides an offline fallback.
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const register = () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
