'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ScanLine, Check } from 'lucide-react';
import { selfCheckIn } from '@/lib/actions/checkin';

// Check-in — recreates revamp/member.html "checkin": QR card + tap-to-check-in
// → success ring. The tap calls the selfCheckIn server action (writes a
// check_ins row); the success line shows days left on the plan.
export default function CheckinPage() {
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function check() {
    start(async () => {
      const res = await selfCheckIn();
      if (res.ok) {
        setMsg(res.daysLeft != null ? `${res.daysLeft} day${res.daysLeft === 1 ? '' : 's'} left on your plan.` : 'Checked in.');
        setDone(true);
        router.refresh();
      } else {
        setErr(res.error);
      }
    });
  }

  return (
    <section className="view on" data-v="checkin">
      {!done ? (
        <div className="ci">
          <div className="mhead" style={{ justifyContent: 'center', paddingBottom: 6 }}>
            <strong className="htitle">Check in</strong>
          </div>
          <h2>Scan at the door</h2>
          <p>Show this code at the entrance, or tap to self check-in.</p>
          <div className="qr">
            <svg viewBox="0 0 100 100" shapeRendering="crispEdges" aria-label="Check-in QR code" role="img">
              <rect width="100" height="100" fill="#fff" />
              <g fill="#0a0a12">
                <rect x="8" y="8" width="24" height="24" /><rect x="12" y="12" width="16" height="16" fill="#fff" /><rect x="16" y="16" width="8" height="8" />
                <rect x="68" y="8" width="24" height="24" /><rect x="72" y="12" width="16" height="16" fill="#fff" /><rect x="76" y="16" width="8" height="8" />
                <rect x="8" y="68" width="24" height="24" /><rect x="12" y="72" width="16" height="16" fill="#fff" /><rect x="16" y="76" width="8" height="8" />
                <rect x="40" y="8" width="4" height="4" /><rect x="48" y="8" width="4" height="4" /><rect x="56" y="12" width="4" height="4" />
                <rect x="40" y="20" width="4" height="4" /><rect x="52" y="24" width="4" height="4" /><rect x="60" y="20" width="4" height="4" />
                <rect x="40" y="40" width="4" height="4" /><rect x="48" y="44" width="4" height="4" /><rect x="56" y="40" width="4" height="4" /><rect x="64" y="48" width="4" height="4" /><rect x="72" y="40" width="4" height="4" /><rect x="84" y="44" width="4" height="4" />
                <rect x="40" y="56" width="4" height="4" /><rect x="52" y="60" width="4" height="4" /><rect x="64" y="56" width="4" height="4" /><rect x="80" y="60" width="4" height="4" />
                <rect x="44" y="72" width="4" height="4" /><rect x="56" y="76" width="4" height="4" /><rect x="68" y="72" width="4" height="4" /><rect x="84" y="76" width="4" height="4" />
                <rect x="40" y="84" width="4" height="4" /><rect x="60" y="88" width="4" height="4" /><rect x="76" y="84" width="4" height="4" /><rect x="88" y="88" width="4" height="4" />
              </g>
            </svg>
          </div>
          <button className="gf-btn gf-btn-primary gf-btn-lg ci-btn" onClick={check} disabled={pending}>
            <ScanLine strokeWidth={1.9} style={{ width: 18, height: 18 }} /> {pending ? 'Checking in…' : 'Tap to check in'}
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
    </section>
  );
}
