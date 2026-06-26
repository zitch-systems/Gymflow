import Link from 'next/link';

export const metadata = { title: 'Offline' };

// Shown by the service worker when a navigation fails with no network.
export default function Offline() {
  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '40px 24px', gap: 16 }}>
      <h1 style={{ fontFamily: 'var(--gf-font-display)', fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>You&apos;re offline</h1>
      <p style={{ color: 'var(--gf-text-secondary)', margin: 0, maxWidth: '32ch', lineHeight: 1.5 }}>
        GymFlow needs a connection to load this page. Check your network and try again.
      </p>
      <Link href="/dashboard" className="gf-btn gf-btn-primary">Retry</Link>
    </main>
  );
}
