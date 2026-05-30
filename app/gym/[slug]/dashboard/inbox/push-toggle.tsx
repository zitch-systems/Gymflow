'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { urlBase64ToUint8Array } from '@/lib/push-keys';
import { useToast } from '@/lib/toast';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

type State = 'unsupported' | 'loading' | 'off' | 'on' | 'denied';

// Opt-in toggle for Web Push on this device. Renders nothing when push is
// unsupported or no public VAPID key is configured, so the feature stays
// invisible until it's actually wired up — no dead button.
export function PushToggle({ gymId }: { gymId: string }) {
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    !!VAPID_PUBLIC_KEY;

  // Capability + current-subscription detection is client-only (depends on
  // navigator/Notification), so it must run in the effect to keep SSR and the
  // first client paint identical ('loading' → null). Same documented
  // exception the QR check-in button uses.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!supported) { setState('unsupported'); return; }
    if (Notification.permission === 'denied') { setState('denied'); return; }
    /* eslint-enable react-hooks/set-state-in-effect */
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? 'on' : 'off'))
      .catch(() => setState('off'));
  }, [supported]);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setState(permission === 'denied' ? 'denied' : 'off'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
      });
      const json = sub.toJSON();
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, gymId }),
      });
      if (!res.ok) throw new Error('subscribe failed');
      setState('on');
      toast('Push notifications on for this device.', 'success');
    } catch {
      toast('Could not enable push notifications.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState('off');
      toast('Push notifications off for this device.', 'success');
    } catch {
      toast('Could not turn off push notifications.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'unsupported' || state === 'loading') return null;

  if (state === 'denied') {
    return (
      <p className="gf-form-hint" style={{ margin: 0 }}>
        <BellOff size={13} strokeWidth={1.75} style={{ verticalAlign: '-2px', marginRight: 4 }} />
        Push is blocked in your browser settings.
      </p>
    );
  }

  const on = state === 'on';
  return (
    <button
      type="button"
      className="gf-btn gf-btn-ghost gf-btn-sm"
      disabled={busy}
      onClick={on ? disable : enable}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      {on ? <BellOff size={15} strokeWidth={1.75} /> : <Bell size={15} strokeWidth={1.75} />}
      {busy ? '…' : on ? 'Turn off push' : 'Enable push'}
    </button>
  );
}
