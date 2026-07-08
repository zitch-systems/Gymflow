import Link from 'next/link';
import { ArrowLeft, ClipboardCheck, ShieldCheck, FileText } from 'lucide-react';
import { requireMember } from '@/lib/auth/dal';

export const metadata = { title: 'Waiver & documents' };

// Waiver & documents — kept in-app (inside the member PWA shell) rather than
// bouncing to the public /legal marketing page. Shows the liability waiver the
// member accepted plus a short data/security note, scoped to their gym.
export default async function DocumentsPage() {
  const { gym } = await requireMember();

  return (
    <section className="view on" data-v="documents">
      <div className="mhead" style={{ justifyContent: 'flex-start', gap: 10, paddingBottom: 6 }}>
        <Link href="/dashboard/profile" className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Back"><ArrowLeft strokeWidth={1.9} /></Link>
        <strong className="htitle">Waiver &amp; documents</strong>
      </div>

      <div className="doc-card">
        <div className="doc-h"><span className="doc-ic"><ClipboardCheck strokeWidth={1.8} /></span><h2>Liability waiver</h2></div>
        <p className="doc-sub">Accepted when you joined {gym.name}.</p>
        <h3>Assumption of risk</h3>
        <p>You acknowledge that physical exercise carries inherent risks, including injury, and choose to participate voluntarily and at your own risk.</p>
        <h3>Health declaration</h3>
        <p>You confirm you are in suitable health to exercise and will stop and seek help if you feel unwell. You will disclose relevant conditions to gym staff.</p>
        <h3>Release</h3>
        <p>To the extent permitted by law, you release {gym.name} and its staff from liability for injury arising from ordinary use of the facilities, except in cases of gross negligence.</p>
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
