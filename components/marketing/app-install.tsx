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
    <svg viewBox="0 0 24 24" width="20" height="22" fill="currentColor" aria-hidden focusable="false">
      <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z" />
    </svg>
  );
}
function AndroidGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden focusable="false">
      <path d="M17.523 15.341c-.552 0-1-.449-1-1 0-.552.448-1 1-1 .551 0 .999.448.999 1 0 .551-.448 1-1 1m-11.046 0c-.552 0-1-.449-1-1 0-.552.448-1 1-1 .551 0 .999.448.999 1 0 .551-.448 1-1 1m11.405-6.02l1.997-3.459a.416.416 0 00-.72-.416l-2.022 3.503A12.6 12.6 0 0012 7.851c-1.831 0-3.581.4-5.137 1.098L4.841 5.446a.416.416 0 00-.72.416l1.997 3.46C2.689 11.187.343 14.659 0 18.761h24c-.343-4.102-2.689-7.574-6.118-9.44" />
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
