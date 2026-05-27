import Link from 'next/link';
import { LogoMark } from '@/components/ui/logo';
import { OfflineRetryClient } from './offline-retry-client';

export const metadata = {
  title: 'Offline — GymFlow',
};

export default function OfflinePage() {
  return (
    <>
      <div className="status-badge">
        <span className="status-dot" />
        No internet connection
      </div>

      <div className="offline-icon">
        <svg
          width="36"
          height="36"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
        >
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
          <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
      </div>

      <h1 className="offline-title">You&apos;re offline</h1>

      <p className="offline-body">
        GymFlow needs an internet connection to sync your data. Check your connection and try again.
      </p>

      <OfflineRetryClient />

      <div className="logo-wrap">
        <Link href="/" className="gf-logo gf-logo-sm">
          <LogoMark />
          <span className="gf-logo-text">
            Gym<em>Flow</em>
          </span>
        </Link>
      </div>
    </>
  );
}
