'use client';

import { ClipboardCheck, ShieldCheck } from 'lucide-react';
import { signWaiver } from '@/lib/actions/waiver';
import { useState } from 'react';
import { unstable_rethrow, useRouter } from 'next/navigation';
import type { WaiverDocument } from '@/lib/waiver-core';

export function WaiverWall({ gymId, gymName, document }: { gymId: string; gymName: string; document: WaiverDocument }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const result = await signWaiver({ gymId, revision: document.revision });
      if (result?.error) { setError(result.error); router.refresh(); }
    }
    catch (cause) {
      unstable_rethrow(cause);
      setError('We could not save your acceptance. Please check your connection and try again.');
    } finally { setPending(false); }
  }

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
        <div className="doc-h"><span className="doc-ic"><ShieldCheck strokeWidth={1.8} /></span><h2>{document.title}</h2></div>
        {document.version && <p className="doc-sub">Version {document.version}</p>}
        <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{document.content}</div>
      </div>

      <form action={submit} aria-busy={pending} style={{ padding: '0 0 40px' }}>
        {error && <p role="alert" style={{ color: 'var(--gf-danger)' }}>{error}</p>}
        <button type="submit" className="gf-btn gf-btn-primary gf-btn-full" disabled={pending}>
          {pending ? 'Signing…' : 'I agree — sign waiver'}
        </button>
      </form>
    </section>
  );
}
