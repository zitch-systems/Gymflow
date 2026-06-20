import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export const metadata = { title: 'Page not found' };

// Custom 404. Self-contained inline styling so it renders correctly regardless
// of which route group the missing path would have belonged to.
export default function NotFound() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '2rem', textAlign: 'center', background: 'var(--gf-bg, #0a0a12)', color: 'var(--gf-text, #f4f4f7)' }}>
      <div style={{ maxWidth: 460 }}>
        <p style={{ fontSize: '3.5rem', fontWeight: 800, margin: 0, color: 'var(--gf-brand, #6c5ce7)' }}>404</p>
        <h1 style={{ fontSize: '1.5rem', margin: '0.25rem 0 0.5rem' }}>Page not found</h1>
        <p style={{ color: 'var(--gf-text-muted, #9a9aa8)', margin: '0 0 1.5rem' }}>
          The page you’re looking for doesn’t exist or has moved.
        </p>
        <Link href="/" className="gf-btn gf-btn-primary gf-btn-lg" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Back to home <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} />
        </Link>
      </div>
    </main>
  );
}
