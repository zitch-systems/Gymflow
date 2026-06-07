import Link from 'next/link';
import { Logo } from '@/components/ui/logo';

export const metadata = { title: 'Page not found — GymFlow' };

export default function NotFound() {
  return (
    <main className="gf-status-screen">
      <div className="gf-status-screen-inner">
        <Logo size="sm" />
        <div className="gf-status-code gf-gradient-text">404</div>
        <h1 className="gf-status-title">We couldn&apos;t find that page</h1>
        <p className="gf-status-body">
          The link may be broken, or the page may have moved. Let&apos;s get you back on track.
        </p>
        <div className="gf-status-actions">
          <Link href="/" className="gf-btn gf-btn-primary">Back home</Link>
          <Link href="/login" className="gf-btn gf-btn-secondary">Sign in</Link>
        </div>
      </div>
    </main>
  );
}
