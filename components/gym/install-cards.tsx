'use client';

import { useEffect, useState } from 'react';
import { Smartphone, TabletSmartphone, Check, WifiOff } from 'lucide-react';

// The member app is an installable PWA and is NOT in the App Store or Play
// Store, so this section shows install *instructions* per platform rather than
// store badges — a badge would send a member to a dead end
// (GYM-LANDING-BUILD.md §5).
//
// Three behaviours the prototype implies and static markup can't do:
//   1. show the visitor's own platform first
//   2. on Chromium, swap the Android steps for a real Install button once
//      `beforeinstallprompt` fires
//   3. hide the whole section when they've already installed it

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function InstallCards({ gymName }: { gymName: string }) {
  // 'unknown' until mounted: the server can't know the platform, and guessing
  // would reorder the cards after hydration.
  const [platform, setPlatform] = useState<'ios' | 'android' | 'unknown'>('unknown');
  const [installed, setInstalled] = useState(false);
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    // Both reads happen in a microtask rather than synchronously in the effect:
    // the lint rule is right that a sync setState here causes a second render
    // pass before paint, and neither value is needed that early.
    queueMicrotask(() => {
      const ua = navigator.userAgent;
      if (/iPad|iPhone|iPod/.test(ua)) setPlatform('ios');
      else if (/Android/.test(ua)) setPlatform('android');
      if (window.matchMedia('(display-mode: standalone)').matches) setInstalled(true);
    });

    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    try { await deferred.userChoice; } catch { /* dismissed */ }
    setDeferred(null);
  }

  if (installed) return null;

  const ios = (
    <div className="ins" key="ios">
      <div className="hd"><span className="ic"><Smartphone strokeWidth={1.75} /></span><strong>iPhone &amp; iPad</strong></div>
      <ol>
        <li>Open this page in <b>Safari</b></li>
        <li>Tap <b>Share</b></li>
        <li>Choose <b>Add to Home Screen</b></li>
      </ol>
    </div>
  );

  const android = (
    <div className="ins" key="android">
      <div className="hd"><span className="ic"><TabletSmartphone strokeWidth={1.75} /></span><strong>Android</strong></div>
      {deferred ? (
        // Chromium gave us a real prompt — offer the one-tap path instead of
        // telling them to hunt through a menu.
        <>
          <p style={{ margin: '0 0 12px', fontSize: '.86rem', color: 'var(--gf-text-secondary)', lineHeight: 1.5 }}>
            Add {gymName} to your home screen in one tap.
          </p>
          <button type="button" className="b b-acc b-sm" onClick={install}>Install app</button>
        </>
      ) : (
        <ol>
          <li>Open this page in <b>Chrome</b></li>
          <li>Tap the <b>⋮ menu</b></li>
          <li>Choose <b>Install app</b></li>
        </ol>
      )}
    </div>
  );

  return (
    <>
      <ul className="app-feats">
        <li><Check strokeWidth={1.75} /> Check in with your QR code</li>
        <li><Check strokeWidth={1.75} /> Book and cancel classes</li>
        <li><Check strokeWidth={1.75} /> See how busy the gym is</li>
        <li><Check strokeWidth={1.75} /> Renew and get receipts</li>
      </ul>
      <div className="inst">{platform === 'android' ? [android, ios] : [ios, android]}</div>
      <div className="app-note">
        <WifiOff strokeWidth={1.75} /> Check-in keeps working at the door even when the network drops.
      </div>
    </>
  );
}
