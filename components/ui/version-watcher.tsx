'use client';

import { useEffect } from 'react';

// Why this exists: an installed PWA (or any long-open tab) keeps its original JS
// bundle in memory. Client-side navigation reuses that old bundle, so after a
// deploy members keep seeing the previous UI until a *full* document load — which
// for an installed app means manually force-quitting. The service worker can't
// fix this on its own (a running page won't swap bundles mid-flight).
//
// So: every build bakes in a NEXT_PUBLIC_BUILD_ID, and /api/version echoes the
// live server's id. When the app regains focus/visibility we compare the two and
// hard-reload if they diverge — picking up the new HTML + freshly-hashed chunks.
// We only act on visibility/focus (never mid-interaction) and guard with
// sessionStorage so a single deploy can never cause a reload loop.
export function VersionWatcher() {
  useEffect(() => {
    const current = process.env.NEXT_PUBLIC_BUILD_ID;
    if (!current) return;
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return;

    let inFlight = false;
    const check = async () => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const { buildId } = (await res.json()) as { buildId?: string };
        if (buildId && buildId !== current) {
          const key = `gf-reloaded-${buildId}`;
          if (sessionStorage.getItem(key)) return; // already reloaded onto this build
          sessionStorage.setItem(key, '1');
          window.location.reload();
        }
      } catch {
        // Offline or transient — leave the page as-is and retry on next focus.
      } finally {
        inFlight = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    void check(); // also on mount — covers a session resumed from the background

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  return null;
}
