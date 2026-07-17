'use client';

import { useEffect, useState } from 'react';

// The member experience is a PWA ("add to home screen"), not a native store
// app — so "download" means install the web app. This renders iOS + Android
// install buttons: on Chromium (Android/desktop) the Android button fires the
// real beforeinstallprompt; iOS Safari has no such API, so its button reveals
// the Share → Add to Home Screen steps. If the app is already installed
// (standalone display-mode) the whole CTA hides itself.

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const BADGE_BG = '#0b0b0d';

// Simple, generic platform glyphs (an apple for iOS, a play triangle for
// Android) — the labels carry the meaning; these are just recognisable marks.
function AppleGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden focusable="false">
      <circle cx="12" cy="13.6" r="6.4" />
      <path d="M12 7.2c.1-1.8 1.5-3.1 3.2-3.3.2 1.7-1 3.2-3.2 3.3z" />
    </svg>
  );
}
function AndroidGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden focusable="false">
      <path d="M8 5.4v13.2l11-6.6z" />
    </svg>
  );
}

function Badge({ glyph, sub, name, onClick, expanded }: {
  glyph: React.ReactNode; sub: string; name: string; onClick: () => void; expanded: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 10,
        background: BADGE_BG, color: '#fff', border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: 12, padding: '9px 16px', cursor: 'pointer', minWidth: 168,
        textAlign: 'left', lineHeight: 1.1, transition: 'transform .15s ease, box-shadow .15s ease',
      }}
      className="gl-appdl-badge"
    >
      <span style={{ display: 'inline-flex', flexShrink: 0 }}>{glyph}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <small style={{ fontSize: '0.66rem', opacity: 0.8, letterSpacing: '0.02em' }}>{sub}</small>
        <strong style={{ fontSize: '1.02rem', fontWeight: 600 }}>{name}</strong>
      </span>
    </button>
  );
}

export function AppInstall({ gymName }: { gymName: string }) {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState<null | 'ios' | 'android'>(null);

  // Both handlers set state only from async browser events (not synchronously
  // during the effect). The "already installed at load" case is handled purely
  // in CSS via @media (display-mode: standalone) on .gl-appdl-wrap, so there's
  // no synchronous setState here and no hydration mismatch.
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); setHelp(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function onAndroid() {
    if (deferred) {
      await deferred.prompt();
      try { await deferred.userChoice; } catch { /* dismissed */ }
      setDeferred(null);
      return;
    }
    setHelp((h) => (h === 'android' ? null : 'android'));
  }
  function onIOS() { setHelp((h) => (h === 'ios' ? null : 'ios')); }

  if (installed) return null;

  return (
    <div className="gl-appdl-wrap" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
        <Badge glyph={<AppleGlyph />} sub="Download for" name="iOS" onClick={onIOS} expanded={help === 'ios'} />
        <Badge glyph={<AndroidGlyph />} sub="Download for" name="Android" onClick={onAndroid} expanded={help === 'android'} />
      </div>
      {help && (
        <p role="status" style={{ maxWidth: 460, textAlign: 'center', fontSize: '0.9rem', color: 'var(--gf-text-secondary)', margin: 0 }}>
          {help === 'ios' ? (
            <>In Safari, tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong> to install {gymName} on your iPhone or iPad.</>
          ) : (
            <>Open your browser menu (⋮), then tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>) to install {gymName} on your device.</>
          )}
        </p>
      )}
    </div>
  );
}
