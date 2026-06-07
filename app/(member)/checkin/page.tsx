'use client';

import { useState } from 'react';
import { ScanLine, Check } from 'lucide-react';

// Check-in — recreates revamp/member.html "checkin": a QR card + tap-to-check-in
// that swaps to a success ring. Static QR svg (the prototype's), no backend.
export default function CheckinPage() {
  const [done, setDone] = useState(false);

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
          <button className="gf-btn gf-btn-primary gf-btn-lg ci-btn" onClick={() => setDone(true)}>
            <ScanLine strokeWidth={1.9} style={{ width: 18, height: 18 }} /> Tap to check in
          </button>
        </div>
      ) : (
        <div className="ci-ok on">
          <div className="ring"><Check strokeWidth={2.4} /></div>
          <h2 style={{ fontFamily: 'var(--gf-font-display)', fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>You&apos;re in!</h2>
          <p style={{ color: 'var(--gf-text-secondary)', margin: 0 }}>Checked in at Main entrance · just now</p>
          <button className="gf-btn gf-btn-secondary" onClick={() => setDone(false)}>Done</button>
        </div>
      )}
    </section>
  );
}
