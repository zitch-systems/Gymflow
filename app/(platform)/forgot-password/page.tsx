import Link from 'next/link';
import { ThemeToggleButton } from '@/lib/theme';
import { LogoMark } from '@/components/ui/logo';
import { ForgotPasswordForm } from './forgot-password-form';
import { Star, ArrowLeft } from 'lucide-react';

export const metadata = {
  title: 'Forgot your password?',
  description: 'Reset your GymFlow password.',
};

export default function ForgotPasswordPage() {
  return (
    <div className="gf-auth">
      <aside className="brandside">
        <div className="brandside-bg" aria-hidden />
        <Link href="/" className="auth-brand gf-logo">
          <LogoMark />
          <span className="gf-logo-text">Gym<em>Flow</em></span>
        </Link>
        <div className="bs-quote">
          <div className="stars" aria-hidden>
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} size={18} strokeWidth={1.75} />
            ))}
          </div>
          <p>&ldquo;Getting back in took ten seconds. The reset email landed instantly and my whole dashboard was right where I left it.&rdquo;</p>
          <div className="by">
            <span className="gf-avatar gf-avatar-md">N</span>
            <span><strong>Ngozi Eze</strong><small>FlexZone, Abuja</small></span>
          </div>
          <dl className="bs-stats">
            <div><dt>Active gyms</dt><dd>1,200+</dd></div>
            <div><dt>Check-ins / mo</dt><dd>480K</dd></div>
            <div><dt>Uptime</dt><dd>99.9%</dd></div>
          </dl>
        </div>
      </aside>

      <main className="formside">
        <div className="formcard">
          <ForgotPasswordForm />
          <Link href="/login" className="back-link"><ArrowLeft /> Back to sign in</Link>
        </div>
      </main>

      <ThemeToggleButton />
    </div>
  );
}
