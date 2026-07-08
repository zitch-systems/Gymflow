'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ScanLine, Check, Camera, Hash } from 'lucide-react';
import { selfCheckIn, selfCheckOut, generateCheckinCode, checkinState } from '@/lib/actions/checkin';
import { QrScanner } from '@/components/member/qr-scanner';

// Check-in / check-out — the member either scans the gym's door QR with their
// camera, taps to self check-in/out, or generates a short-lived 6-digit code
// and reads it to reception (who keys it into the admin console). Which
// direction each path runs depends on whether they're currently inside.
// Opening /checkin?via=qr (what the door QR encodes, e.g. via the phone's
// native camera) auto-runs the appropriate direction.

type Props = { initialCheckedIn: boolean; checkedInAt: string | null };

function timeOf(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function CheckinClient({ initialCheckedIn, checkedInAt }: Props) {
  const [checkedIn, setCheckedIn] = useState(initialCheckedIn);
  const [done, setDone] = useState<null | 'in' | 'out'>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState<{ value: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, start] = useTransition();
  const router = useRouter();
  const autoRan = useRef(false);

  const doCheckIn = useCallback(() => {
    start(async () => {
      const res = await selfCheckIn();
      if (res.ok) {
        setErr(null);
        setMsg(res.daysLeft != null ? `${res.daysLeft} day${res.daysLeft === 1 ? '' : 's'} left on your plan.` : null);
        setCheckedIn(true); setDone('in'); setCode(null);
        router.refresh();
      } else {
        setErr(res.error);
      }
    });
  }, [router]);

  const doCheckOut = useCallback(() => {
    start(async () => {
      const res = await selfCheckOut();
      if (res.ok) {
        setErr(null); setMsg(null);
        setCheckedIn(false); setDone('out'); setCode(null);
        router.refresh();
      } else {
        setErr(res.error);
      }
    });
  }, [router]);

  // Arrived via the door QR (native camera → /checkin?via=qr) → run once, in
  // the direction the server said we're in.
  useEffect(() => {
    if (autoRan.current) return;
    const via = new URLSearchParams(window.location.search).get('via');
    if (via === 'qr') { autoRan.current = true; (initialCheckedIn ? doCheckOut : doCheckIn)(); }
  }, [doCheckIn, doCheckOut, initialCheckedIn]);

  const onScanned = useCallback((text: string) => {
    setScanning(false);
    if (/\/checkin/i.test(text) || /[?&]via=qr/i.test(text)) {
      (checkedIn ? doCheckOut : doCheckIn)();
    } else {
      setErr('That isn’t this gym’s check-in code. Scan the QR at the entrance.');
    }
  }, [checkedIn, doCheckIn, doCheckOut]);

  const getCode = useCallback(() => {
    start(async () => {
      const res = await generateCheckinCode();
      if (res.ok) {
        setErr(null);
        setNow(Date.now());
        setCode({ value: res.code, expiresAt: new Date(res.expiresAt).getTime() });
      } else {
        setErr(res.error);
      }
    });
  }, []);

  // While a code is on screen: tick the countdown, and poll so the page flips
  // to the success panel the moment reception redeems the code.
  useEffect(() => {
    if (!code) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [code]);

  useEffect(() => {
    if (!code) return;
    let stopped = false;
    const poll = setInterval(async () => {
      const { checkedIn: nowIn } = await checkinState();
      if (stopped || nowIn === checkedIn) return;
      setCheckedIn(nowIn); setDone(nowIn ? 'in' : 'out');
      setMsg(null); setCode(null);
      router.refresh();
    }, 4000);
    return () => { stopped = true; clearInterval(poll); };
  }, [code, checkedIn, router]);

  const secondsLeft = code ? Math.max(0, Math.ceil((code.expiresAt - now) / 1000)) : 0;
  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;
  const inTime = timeOf(checkedInAt);

  if (done) {
    return (
      <section className="view on" data-v="checkin">
        <div className="ci-ok on">
          <div className="ring"><Check strokeWidth={2.4} /></div>
          <h2 style={{ fontFamily: 'var(--gf-font-display)', fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>
            {done === 'in' ? 'You’re in!' : 'See you next time!'}
          </h2>
          <p style={{ color: 'var(--gf-text-secondary)', margin: 0, textAlign: 'center' }}>
            {done === 'in' ? 'Checked in just now' : 'Checked out just now'}{msg ? ` · ${msg}` : ''}
          </p>
          <button className="gf-btn gf-btn-secondary" onClick={() => { setDone(null); setMsg(null); }}>Done</button>
        </div>
      </section>
    );
  }

  if (code) {
    return (
      <section className="view on" data-v="checkin">
        <div className="ci">
          <div className="mhead" style={{ justifyContent: 'center', paddingBottom: 6 }}>
            <strong className="htitle">Front desk code</strong>
          </div>
          <h2>Show this at the desk</h2>
          <p>Reception enters this code to check you {checkedIn ? 'out' : 'in'}.</p>
          <div className="ci-code">
            <span className="ci-code-digits" aria-label={`Your code is ${code.value.split('').join(' ')}`}>{code.value}</span>
            {secondsLeft > 0
              ? <small className="ci-code-exp">Expires in {countdown}</small>
              : <small className="ci-code-exp" style={{ color: 'var(--gf-danger)' }}>This code has expired.</small>}
          </div>
          {secondsLeft === 0 && (
            <button className="gf-btn gf-btn-primary gf-btn-lg ci-btn" onClick={getCode} disabled={pending}>
              <Hash strokeWidth={1.9} style={{ width: 18, height: 18 }} /> {pending ? 'One sec…' : 'Get a new code'}
            </button>
          )}
          <button className="ci-self" onClick={() => setCode(null)}>Back</button>
          {err && <p style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', marginTop: 14 }}>{err}</p>}
        </div>
      </section>
    );
  }

  return (
    <section className="view on" data-v="checkin">
      <div className="ci">
        <div className="mhead" style={{ justifyContent: 'center', paddingBottom: 6 }}>
          <strong className="htitle">{checkedIn ? 'Check out' : 'Check in'}</strong>
        </div>
        <h2>{checkedIn ? 'Ready to head out?' : 'Scan at the door'}</h2>
        <p>
          {checkedIn
            ? `You’re checked in${inTime ? ` since ${inTime}` : ''}. Scan the door QR on your way out, or tap below.`
            : 'Scan the gym’s QR code at the entrance, or tap to self check-in.'}
        </p>
        <button className="qr qr-tap" onClick={() => { setErr(null); setScanning(true); }} aria-label={`Open camera to scan the ${checkedIn ? 'check-out' : 'check-in'} QR`}>
          <Camera strokeWidth={1.4} />
          <span>Tap to scan the door QR</span>
        </button>
        <button className="gf-btn gf-btn-primary gf-btn-lg ci-btn" onClick={() => { setErr(null); setScanning(true); }} disabled={pending}>
          <Camera strokeWidth={1.9} style={{ width: 18, height: 18 }} /> Scan to check {checkedIn ? 'out' : 'in'}
        </button>
        <button className="ci-self" onClick={checkedIn ? doCheckOut : doCheckIn} disabled={pending}>
          <ScanLine strokeWidth={1.9} style={{ width: 16, height: 16 }} />
          {pending ? (checkedIn ? 'Checking out…' : 'Checking in…') : `Or tap to self check-${checkedIn ? 'out' : 'in'}`}
        </button>
        <button className="ci-self" onClick={getCode} disabled={pending}>
          <Hash strokeWidth={1.9} style={{ width: 16, height: 16 }} /> No camera? Get a code for the front desk
        </button>
        {err && <p style={{ color: 'var(--gf-danger)', fontSize: '0.84rem', marginTop: 14 }}>{err}</p>}
      </div>

      {scanning && <QrScanner onDetected={onScanned} onClose={() => setScanning(false)} />}
    </section>
  );
}
