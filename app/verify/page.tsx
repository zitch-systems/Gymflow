import { redirect } from 'next/navigation';
import { readPendingChallenge } from '@/lib/auth/two-factor';
import { VerifyClient } from './verify-client';

// Second step of a staff sign-in. Reachable only with the httpOnly challenge
// cookie signIn set after verifying the password — no cookie, no page, so this
// URL is not a way to probe whether an address has two-factor enabled.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Verify it’s you · GymFlow',
  // Never index a page that only exists mid-authentication.
  robots: { index: false, follow: false },
};

export default async function VerifyPage() {
  const pending = await readPendingChallenge();
  if (!pending) redirect('/login');

  // The address is masked rather than shown: someone at a borrowed screen
  // should be able to tell WHICH inbox to open without the page handing a
  // shoulder-surfer a full address to phish.
  return <VerifyClient maskedEmail={maskEmail(pending.email)} />;
}

/** t***@example.com — enough to recognise, not enough to reuse. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return 'your email';
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}
