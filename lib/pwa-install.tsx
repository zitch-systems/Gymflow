'use client';

import { useEffect, useState } from 'react';
import { Smartphone, X } from 'lucide-react';

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

function shouldHidePromptInitially(): boolean {
  if (typeof window === 'undefined') return true;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true;
  if (isStandalone) return true;
  try {
    const dismissedAt = Number(localStorage.getItem('gf-install-dismissed') ?? 0);
    if (Date.now() - dismissedAt < 7 * 86_400_000) return true;
  } catch {}
  return false;
}

function detectIosSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);
  const inSafari = /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);
  return isIos && inSafari;
}

export function PwaInstallPrompt() {
  const [ready, setReady] = useState<BIPEvent | null>(null);
  const [iosHint, setIosHint] = useState(() => !shouldHidePromptInitially() && detectIosSafari());
  const [dismissed, setDismissed] = useState(() => shouldHidePromptInitially());

  useEffect(() => {
    if (typeof window === 'undefined' || dismissed) return;
    const handler = (e: Event) => {
      e.preventDefault();
      setReady(e as BIPEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [dismissed]);

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
      <span style={{ color: 'var(--gf-brand)', display: 'inline-flex' }} aria-hidden>
        <Smartphone size={22} strokeWidth={1.75} />
      </span>
      <p style={{ flex: 1, margin: 0, fontSize: 14, color: 'var(--gf-text)' }}>{body}</p>
      {action}
      <button type="button" aria-label="Dismiss" className="gf-btn gf-btn-ghost gf-btn-sm" onClick={onDismiss}>
        <X size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
