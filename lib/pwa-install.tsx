'use client';

import { useState, useSyncExternalStore } from 'react';
import { Smartphone, X, Check, Share } from 'lucide-react';

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

// ── Shared install-prompt store ────────────────────────────────────────────
// The browser fires `beforeinstallprompt` once, early in page load. Capture it
// at module scope so it's never lost to component mount timing, and so multiple
// surfaces (the bottom banner + the "Install app" row in Settings) can offer
// it. `appinstalled` clears it again.
let deferredPrompt: BIPEvent | null = null;
const subscribers = new Set<() => void>();
function emit() { for (const s of subscribers) s(); }

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BIPEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    emit();
  });
}

function subscribe(cb: () => void) { subscribers.add(cb); return () => { subscribers.delete(cb); }; }
function getSnapshot() { return deferredPrompt; }
function getServerSnapshot(): BIPEvent | null { return null; }

/** The captured, deferred `beforeinstallprompt` event, or null when the app is
 *  already installed / the browser hasn't offered one. */
function useInstallPrompt() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Read a browser-only boolean without a hydration mismatch (server resolves to
// `serverValue`, then the client re-renders with the real value) and without
// setState-in-effect. The values don't change mid-session, so the subscribe
// is a no-op.
const noopSubscribe = () => () => {};
function useClientFlag(read: () => boolean): boolean {
  return useSyncExternalStore(noopSubscribe, read, () => false);
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true;
}

function detectIosSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);
  const inSafari = /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);
  return isIos && inSafari;
}

async function fireInstall(p: BIPEvent) {
  await p.prompt();
  await p.userChoice;
  deferredPrompt = null;
  emit();
}

// ── Global one-shot banner ──────────────────────────────────────────────────
function bannerHiddenInitially(): boolean {
  if (typeof window === 'undefined') return true;
  if (isStandalone()) return true;
  try {
    const dismissedAt = Number(localStorage.getItem('gf-install-dismissed') ?? 0);
    if (Date.now() - dismissedAt < 7 * 86_400_000) return true;
  } catch {}
  return false;
}

export function PwaInstallPrompt() {
  const prompt = useInstallPrompt();
  // Browser-only checks via useSyncExternalStore so SSR and the first client
  // render agree (no hydration mismatch) without setState-in-effect.
  const hiddenInitially = useClientFlag(bannerHiddenInitially);
  const iosHint = useClientFlag(detectIosSafari);
  const [dismissed, setDismissed] = useState(false);

  if (hiddenInitially || dismissed || (!prompt && !iosHint)) return null;

  function dismiss() {
    try { localStorage.setItem('gf-install-dismissed', String(Date.now())); } catch {}
    setDismissed(true);
  }

  return (
    <InstallBanner
      body={prompt
        ? 'Add GymFlow to your home screen for one-tap access.'
        : 'On iOS: tap Share, then ‘Add to Home Screen’ to install GymFlow.'}
      action={prompt ? (
        <button type="button" className="gf-btn gf-btn-primary gf-btn-sm" onClick={() => fireInstall(prompt)}>
          Install
        </button>
      ) : null}
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

// ── On-demand "Install app" control (member Settings) ───────────────────────
// Lets a member install the app whenever they like, rather than only via the
// one-shot banner. Adapts to platform: native prompt where available, an
// "installed" confirmation in standalone mode, or platform instructions.
export function InstallAppButton() {
  const prompt = useInstallPrompt();
  const standalone = useClientFlag(isStandalone);
  const ios = useClientFlag(detectIosSafari);
  const [justInstalled, setJustInstalled] = useState(false);

  if (standalone || justInstalled) {
    return (
      <p className="gf-form-hint" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--gf-brand)' }}>
        <Check size={16} strokeWidth={2} /> App installed — open it from your home screen.
      </p>
    );
  }

  if (prompt) {
    return (
      <button
        type="button"
        className="gf-btn gf-btn-primary gf-btn-sm"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}
        onClick={async () => { await fireInstall(prompt); setJustInstalled(true); }}
      >
        <Smartphone size={16} strokeWidth={1.9} /> Install app
      </button>
    );
  }

  // No deferred prompt (iOS Safari, or a browser that installs via its own menu).
  return (
    <p className="gf-form-hint" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Share size={15} strokeWidth={1.9} />
      {ios ? 'Tap Share, then “Add to Home Screen”.' : 'Open your browser menu → “Install app” / “Add to Home Screen”.'}
    </p>
  );
}
