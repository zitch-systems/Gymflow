import { requirePlatformAdmin } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import type { AccountDeletionQueueRow } from '@/lib/account-deletion';
import { fmtDateTime } from '@/lib/format';
import { DeletionReviewForm } from './review-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Account deletion requests' };

export default async function AccountDeletionsPage() {
  await requirePlatformAdmin();
  const admin = createAdminClient();
  const columns = 'id, subject_id, status, requested_at, due_at, completed_at, updated_at';
  const [open, recent] = await Promise.all([
    admin.from('account_deletion_requests' as never).select(columns).neq('status', 'completed').order('due_at').limit(100),
    admin.from('account_deletion_requests' as never).select(columns).eq('status', 'completed').order('completed_at', { ascending: false }).limit(20),
  ]);
  if (open.error || recent.error) throw new Error('Account deletion requests could not be loaded. Please retry.');
  const requests = [...(open.data ?? []), ...(recent.data ?? [])] as unknown as AccountDeletionQueueRow[];
  const ids = [...new Set(requests.map((row) => row.subject_id))];
  const profiles = ids.length ? await admin.from('profiles').select('id, full_name, email').in('id', ids) : { data: [], error: null };
  if (profiles.error) throw new Error('Account identities could not be loaded. Please retry.');
  const identities = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
  return <>
    <div className="hdr"><div><span className="pill-plat">Privacy operations</span><h1>Account deletion requests</h1><p>Review daily. Process within the displayed 30-day target, including all gyms and processors.</p></div></div>
    <div className="panel" style={{ padding: 20 }}>
      <p>Follow docs/DATA_ERASURE.md in the release repository. Deactivation alone is not deletion. Never remove financial safeguards to force a cascading delete. Completion requires the actual erasure outcome and confirmation to the person.</p>
      <p>Showing the oldest 100 open requests and the 20 most recent completed requests.</p>
      {!requests.length && <p>No account deletion requests.</p>}
      {requests.map((request) => <article key={request.id} style={{ padding: '20px 0', borderTop: '1px solid var(--gf-border)' }}>
        <h2>{identities.get(request.subject_id)?.full_name ?? 'Account removed'}</h2>
        <p>{identities.get(request.subject_id)?.email ?? 'No contact on profile'} · Subject {request.subject_id}</p>
        <p><strong>{request.status}</strong> · Requested {fmtDateTime(request.requested_at)} · Due {fmtDateTime(request.due_at)}{request.completed_at ? ` · Completed ${fmtDateTime(request.completed_at)}` : ''}</p>
        {request.status !== 'completed' && new Date(request.due_at).getTime() < Date.now() && <p style={{ color: 'var(--gf-danger)' }}>Overdue — prioritize this request.</p>}
        <DeletionReviewForm request={request} />
      </article>)}
    </div>
  </>;
}
