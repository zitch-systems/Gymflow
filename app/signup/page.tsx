import { LoginClient } from '../login/login-client';

export const metadata = {
  title: 'Launch your gym',
  description: 'Create your GymFlow workspace in one step — branded subdomain included.',
};

// Signup is the login screen pre-switched to the "Create gym" tab.
export default function SignupPage() {
  return <LoginClient initialMode="up" />;
}
