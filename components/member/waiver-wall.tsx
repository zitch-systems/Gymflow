'use client';

import { ClipboardCheck, ShieldCheck } from 'lucide-react';
import { signWaiver } from '@/lib/actions/waiver';
import { useState } from 'react';

export function WaiverWall({ gymName }: { gymName: string }) {
  const [pending, setPending] = useState(false);

  return (
    <section className="view on" data-v="waiver">
      <div className="mhead" style={{ justifyContent: 'center', paddingBottom: 6 }}>
        <strong className="htitle">Sign waiver</strong>
      </div>

      <div className="waiver-intro">
        <span className="waiver-ic"><ClipboardCheck strokeWidth={1.6} /></span>
        <h2>Before you start</h2>
        <p>Please review and accept the waiver below to use {gymName}.</p>
      </div>

      <div className="doc-card">
        <div className="doc-h"><span className="doc-ic"><ShieldCheck strokeWidth={1.8} /></span><h2>Liability waiver</h2></div>
        <h3>Assumption of risk</h3>
        <p>You acknowledge that physical exercise carries inherent risks, including injury, and choose to participate voluntarily and at your own risk.</p>
        <h3>Health declaration</h3>
        <p>You confirm you are in suitable health to exercise and will stop and seek help if you feel unwell. You will disclose relevant conditions to gym staff.</p>
        <h3>Release</h3>
        <p>To the extent permitted by law, you release {gymName} and its staff from liability for injury arising from ordinary use of the facilities, except in cases of gross negligence.</p>
      </div>

      <form action={async () => { setPending(true); await signWaiver(); }} style={{ padding: '0 0 40px' }}>
        <button type="submit" className="gf-btn gf-btn-primary gf-btn-full" disabled={pending}>
          {pending ? 'Signing…' : 'I agree — sign waiver'}
        </button>
      </form>
    </section>
  );
}
