import { requireMember } from '@/lib/auth/dal';
import { CheckinClient } from './checkin-client';

export const metadata = { title: 'Check in' };
export const maxDuration = 60;

// Server gate around the client check-in screen. The member layout no longer
// blocks on requireMember (its shell streams instantly), so every page must
// enforce the gate itself — this was the only member page without one.
export default async function CheckinPage() {
  await requireMember();
  return <CheckinClient />;
}
