'use client';

import { useEffect, useState } from 'react';

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

export function PwaInstallPrompt() {
  const [ready, setReady] = useState<BIPEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Already installed → standalone display mode
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (isStandalone) return;

    // User previously dismissed within the last 7 days
    try {
      const dismissedAt = Number(localStorage.getItem('gf-install-dismissed') ?? 0);
      if (Date.now() - dismissedAt < 7 * 86_400_000) {
        setDismissed(true);
        return;
      }
    } catch {}

    // Android / desktop: native beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      setReady(e as BIPEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // iOS: no native prompt, just hint the user
    const ua = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);
    const inSafari = /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);
    if (isIos && inSafari) setIosHint(true);

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (dismissed || (!ready && !iosHint)) return null;

  function dismiss() {
    try {
      localStorage.setItem('gf-install-dismissed', String(Date.now()));
    } catch {}
    setReady(null);
    setIosHint(false);
    setDismissed(true);
  }

  if (ready) {
    return (
      <InstallBanner
        body="Add GymFlow to your home screen for one-tap access."
        action={
          <button
            type="button"
            className="gf-btn gf-btn-primary gf-btn-sm"
            onClick={async () => {
              await ready.prompt();
              await ready.userChoice;
              setReady(null);
            }}
          >
            Install
          </button>
        }
        onDismiss={dismiss}
      />
    );
  }

  return (
    <InstallBanner
      body="On iOS: tap Share, then ‘Add to Home Screen’ to install GymFlow."
      action={null}
      onDismiss={dismiss}
    />
  );
}

function InstallBanner({ body, action, onDismiss }: { body: string; action: React.ReactNode; onDismiss: () => void }) {
  return (
    <div
      role="dialog"
      aria-label="Install GymFlow"
      style={{
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 'max(env(safe-area-inset-bottom, 0), 12px)',
        zIndex: 90,
        background: 'var(--gf-surface)',
        border: '1px solid var(--gf-border)',
        borderRadius: 14,
        padding: 14,
        boxShadow: 'var(--gf-shadow-md)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span style={{ fontSize: 22 }} aria-hidden>
        📲
      </span>
      <p style={{ flex: 1, margin: 0, fontSize: 14, color: 'var(--gf-text)' }}>{body}</p>
      {action}
      <button type="button" aria-label="Dismiss" className="gf-btn gf-btn-ghost gf-btn-sm" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}
