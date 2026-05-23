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
      .then((r) => console.log('[GF] SW:', r.scope))
      .catch((e) => console.warn('[GF] SW skipped:', e.message));
  }, []);
  return null;
}
