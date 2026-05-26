'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/ui/logo';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="gf-status-screen">
      <div className="gf-status-screen-inner">
        <Logo size="sm" />
        <div className="gf-status-code gf-status-code-danger">!</div>
        <h1 className="gf-status-title">Something went wrong</h1>
        <p className="gf-status-body">
          An unexpected error occurred. You can try again, and if it keeps happening, contact support.
        </p>
        {error.digest ? <p className="gf-status-digest">Reference: {error.digest}</p> : null}
        <div className="gf-status-actions">
          <button type="button" className="gf-btn gf-btn-primary" onClick={() => reset()}>
            Try again
          </button>
          <Link href="/" className="gf-btn gf-btn-secondary">Back home</Link>
        </div>
      </div>
    </main>
  );
}
