'use client';

import { useEffect } from 'react';

export function OfflineRetryClient() {
  useEffect(() => {
    const onOnline = () => window.location.reload();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  return (
    <div className="offline-actions">
      <button
        type="button"
        className="gf-btn gf-btn-primary gf-btn-lg"
        onClick={() => window.location.reload()}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        Try Again
      </button>
      <button type="button" className="gf-btn gf-btn-ghost" onClick={() => history.back()}>
        Go Back
      </button>
    </div>
  );
}
