import Link from 'next/link';
import { ThemeToggleButton } from '@/lib/theme';
import { LogoMark } from '@/components/ui/logo';
import { GymSignupForm } from './gym-signup-form';
import { Globe, LayoutDashboard, Smartphone, Wallet, QrCode, ShieldCheck, Check } from 'lucide-react';

export const metadata = {
  title: 'Open your GymFlow account',
  description: 'Self-onboard your gym onto GymFlow. From ₦13,999/month, cancel anytime.',
};

const PROVISIONED = [
  { icon: Globe, label: 'Branded subdomain', sub: 'yourgym.gymflow.ng, live instantly' },
  { icon: LayoutDashboard, label: 'Full admin portal', sub: 'Members, staff, pricing, analytics' },
  { icon: Smartphone, label: 'Member PWA', sub: 'Installable app for your members' },
  { icon: Wallet, label: 'Paystack subaccount', sub: 'Payments settle straight to you' },
  { icon: QrCode, label: 'Check-in QR codes', sub: 'Print and post at your entrance' },
];

export default function GymSignupPage() {
  return (
    <div className="mk-auth">
      <nav className="marketing-nav">
        <div className="container marketing-nav-inner">
          <Link href="/" className="marketing-logo">
            <span className="marketing-logo-icon" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                <path d="M19.5 7.2A8 8 0 1 0 20 12h-6" />
              </svg>
            </span>
            <span>Gym<span className="marketing-logo-em">Flow</span></span>
          </Link>
          <div className="marketing-nav-links">
            <Link href="/login" className="marketing-nav-link">Sign in</Link>
            <ThemeToggleButton />
          </div>
        </div>
      </nav>

      <div className="container mk-auth-split">
        <aside className="mk-auth-aside">
          <span className="marketing-eyebrow">14-day free trial</span>
          <h1 className="mk-auth-title">Open your gym on GymFlow</h1>
          <p className="mk-auth-sub">
            One signup provisions everything you need to run your gym online — no installs, no hardware,
            live in minutes.
          </p>

          <ul className="mk-provision">
            {PROVISIONED.map(({ icon: Icon, label, sub }) => (
              <li key={label}>
                <span className="mk-provision-icon" aria-hidden><Icon size={18} strokeWidth={1.75} /></span>
                <span>
                  <span className="mk-provision-label">{label}</span>
                  <span className="mk-provision-sub">{sub}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="mk-auth-trust">
            <span><ShieldCheck size={15} strokeWidth={1.75} /> Payments secured by Paystack</span>
            <span><Check size={15} strokeWidth={2.5} /> Cancel anytime · no setup fees</span>
          </div>
        </aside>

        <div className="mk-auth-panel">
          <div className="mk-auth-panel-head">
            <span className="gf-logo gf-logo-sm"><LogoMark /></span>
            <div>
              <h2 className="mk-auth-panel-title">Create your gym</h2>
              <p className="mk-auth-panel-sub">Takes about a minute.</p>
            </div>
          </div>
          <div className="login-card" style={{ marginTop: 4 }}>
            <GymSignupForm />
          </div>
          <p className="login-footer" style={{ marginTop: 16 }}>
            Already onboarded? <Link href="/login">Sign in to your gym</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
