import { LoginClient } from './login-client';

export const metadata = {
  title: 'Sign in',
  description: 'Sign in to your GymFlow dashboard, or launch your gym in an afternoon.',
};

export default function LoginPage() {
  return <LoginClient initialMode="in" />;
}
