'use client';

import Link from 'next/link';
import { AlertCircle, RotateCcw } from 'lucide-react';

export default function MemberError({ reset }: { reset: () => void }) {
  return <section className="view on">
    <div className="empty" role="alert">
      <div className="eic"><AlertCircle strokeWidth={1.6} /></div>
      <h1>We couldn’t load this page</h1>
      <p>Please check your connection and try again.</p>
      <button type="button" className="gf-btn gf-btn-primary" onClick={reset}><RotateCcw size={16} /> Try again</button>
      <Link href="/dashboard" className="gf-btn gf-btn-secondary" style={{ marginTop: 10 }}>Back to home</Link>
    </div>
  </section>;
}
