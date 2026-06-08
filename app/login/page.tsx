import { LoginClient } from './login-client';

export const metadata = {
  title: 'Sign in',
  description: 'Sign in to your GymFlow dashboard, or launch your gym in an afternoon.',
};

// The signIn server action runs in this route's function and makes Supabase
// auth + role-lookup network calls. A free-tier Supabase project that has
// auto-paused takes longer than the platform's default ~10s to resume, which
// surfaces as a 504 on the first login. Widen the budget so the resume
// completes and the login succeeds instead of timing out.
export const maxDuration = 60;

export default function LoginPage() {
  return <LoginClient initialMode="in" />;
}
