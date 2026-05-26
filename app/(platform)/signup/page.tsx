import { ThemeToggleButton } from '@/lib/theme';
import { GymSignupForm } from './gym-signup-form';

export const metadata = {
  title: 'Open your GymFlow account',
  description: 'Self-onboard your gym onto GymFlow. ₦22,999/month or ₦229,999/year, cancel anytime.',
};

export default function GymSignupPage() {
  return (
    <div className="login-wrap" style={{ maxWidth: 560 }}>
      <header className="login-header">
        <h1 className="login-title">Open your gym on GymFlow</h1>
        <p className="login-subtitle">
          From ₦22,999/month to provision your subdomain, admin portal, member PWA, and payments. Cancel anytime.
        </p>
      </header>

      <div className="login-card">
        <GymSignupForm />
      </div>

      <p className="login-footer">
        Already onboarded? <a href="/login">Sign in to your gym</a>
      </p>

      <ThemeToggleButton />
    </div>
  );
}
