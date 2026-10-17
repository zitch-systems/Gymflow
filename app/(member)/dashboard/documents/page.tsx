import Link from 'next/link';
import { ArrowLeft, ClipboardCheck, ShieldCheck, FileText } from 'lucide-react';
import { requireMember } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { getWaiverState } from '@/lib/waiver-core';
import { fmtDateTime } from '@/lib/format';

export const metadata = { title: 'Waiver & documents' };

// Waiver & documents — kept in-app (inside the member PWA shell) rather than
// bouncing to the public /legal marketing page. Shows the liability waiver the
// member accepted plus a short data/security note, scoped to their gym.
export default async function DocumentsPage() {
  const { user, gym } = await requireMember();
  const waiver = await getWaiverState(await createClient(), user.id, gym);

  return (
    <section className="view on" data-v="documents">
      <div className="mhead" style={{ justifyContent: 'flex-start', gap: 10, paddingBottom: 6 }}>
        <Link href="/dashboard/profile" className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Back"><ArrowLeft strokeWidth={1.9} /></Link>
        <strong className="htitle">Waiver &amp; documents</strong>
      </div>

      <div className="doc-card">
        <div className="doc-h"><span className="doc-ic"><ClipboardCheck strokeWidth={1.8} /></span><h2>{waiver.document.title}</h2></div>
        <p className="doc-sub">
          {gym.name}{waiver.document.version ? ` · Version ${waiver.document.version}` : ''}
          {waiver.accepted && waiver.signedAt ? ` · Accepted ${fmtDateTime(waiver.signedAt)}` : ' · Acceptance not recorded for this version'}
        </p>
        <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.7 }}>{waiver.document.content}</div>
      </div>

      <div className="doc-card">
        <div className="doc-h"><span className="doc-ic"><ShieldCheck strokeWidth={1.8} /></span><h2>Your data</h2></div>
        <p>Your data is isolated to {gym.name} with row-level security, encrypted in transit and at rest. Card details are tokenised by our PCI-DSS compliant payments partner — we never store raw card numbers.</p>
      </div>

      <div className="doc-card doc-links">
        <Link href="/legal#privacy" className="doc-link"><FileText strokeWidth={1.8} /> Privacy policy</Link>
        <Link href="/legal#terms" className="doc-link"><FileText strokeWidth={1.8} /> Terms of service</Link>
      </div>
    </section>
  );
}
