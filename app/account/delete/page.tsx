import Link from 'next/link';
import { getUser } from '@/lib/auth/dal';
import { ACCOUNT_DELETION_MESSAGE, getAccountDeletionRequest } from '@/lib/account-deletion';
import { AccountDeletionForm } from './deletion-form';
import type { DeletionState } from '@/lib/actions/account-deletion';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Delete your GymFlow account', robots: { index: false, follow: false } };

export default async function AccountDeletionPage() {
  const user = await getUser();
  let initial: DeletionState = { ok: false, error: null };
  if (user) {
    try { initial = { ok: false, error: null, request: await getAccountDeletionRequest(user.id) }; }
    catch { initial = { ok: false, error: 'We could not load request status. You can retry below.' }; }
  }
  return <main style={{ maxWidth: 640, margin: '48px auto', padding: 24 }}>
    <Link href="/">GymFlow</Link>
    <h1>Delete your account</h1>
    <p>{ACCOUNT_DELETION_MESSAGE}</p>
    <p>You do not need to contact support to submit this request. Deletion does not automatically refund previous payments.</p>
    <AccountDeletionForm email={user?.email ?? null} initial={initial} />
  </main>;
}
