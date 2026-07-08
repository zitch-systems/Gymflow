'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { ScanLine, Check, Camera } from 'lucide-react';
import { selfCheckIn } from '@/lib/actions/checkin';
import { QrScanner } from '@/components/member/qr-scanner';

// Check-in — the member either scans the gym's door QR with their camera or
// taps to self check-in. Both call the selfCheckIn server action (scoped to the
// member's gym). Opening /checkin?via=qr (what the door QR encodes, e.g. via
// the phone's native camera) auto-checks in.
export function CheckinClient() {
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [pending, start] = useTransition();
  const autoRan = useRef(false);

  const doCheckIn = useCallback(() => {
    start(async () => {
      const res = await selfCheckIn();
      if (res.ok) {
        setErr(null);
        setMsg(res.daysLeft != null ? `${res.daysLeft} day${res.daysLeft === 1 ? '' : 's'} left on your plan.` : 'Checked in.');
        setDone(true);
        // No router.refresh() here: the success state is local, and the action
        // already revalidates /dashboard — refreshing forced a second full
        // dynamic render that competed with the success animation.
      } else {
        setErr(res.error);
      }
    });
  }, []);

  // Arrived via the door QR (native camera → /checkin?via=qr) → check in once.
  useEffect(() => {
    if (autoRan.current) return;
    const via = new URLSearchParams(window.location.search).get('via');
    if (via === 'qr') { autoRan.current = true; doCheckIn(); }
  }, [doCheckIn]);

  const onScanned = useCallback((text: string) => {
    setScanning(false);
    if (/\/checkin/i.test(text) || /[?&]via=qr/i.test(text)) {
      doCheckIn();
    } else {
      setErr('That isn’t this gym’s check-in code. Scan the QR at the entrance.');
    }
  }, [doCheckIn]);

  return (
    <section className="view on" data-v="checkin">
      {!done ? (
        <div className="ci">
          <div className="mhead" style={{ justifyContent: 'center', paddingBottom: 6 }}>
            <strong className="htitle">Check in</strong>
          </div>
          <h2>Scan at the door</h2>
          <p>Scan the gym’s QR code at the entrance, or tap to self check-in.</p>
          <button className="qr qr-tap" onClick={() => { setErr(null); setScanning(true); }} aria-label="Open camera to scan the check-in QR">
            <Camera strokeWidth={1.4} />
            <span>Tap to scan the door QR</span>
          </button>
          <button className="gf-btn gf-btn-primary gf-btn-lg ci-btn" onClick={() => { setErr(null); setScanning(true); }} disabled={pending}>
            <Camera strokeWidth={1.9} style={{ width: 18, height: 18 }} /> Scan to check in
          </button>
          <button className="ci-self" onClick={doCheckIn} disabled={pending}>
            <ScanLine strokeWidth={1.9} style={{ width: 16, height: 16 }} /> {pending ? 'Checking in…' : 'Or tap to self check-in'}
          </button>
          {err && <p style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', marginTop: 14 }}>{err}</p>}
        </div>
      ) : (
        <div className="ci-ok on">
          <div className="ring"><Check strokeWidth={2.4} /></div>
          <h2 style={{ fontFamily: 'var(--gf-font-display)', fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>You&apos;re in!</h2>
          <p style={{ color: 'var(--gf-text-secondary)', margin: 0, textAlign: 'center' }}>Checked in just now{msg ? ` · ${msg}` : ''}</p>
          <button className="gf-btn gf-btn-secondary" onClick={() => { setDone(false); setMsg(null); }}>Done</button>
        </div>
      )}

      {scanning && <QrScanner onDetected={onScanned} onClose={() => setScanning(false)} />}
    </section>
  );
}
