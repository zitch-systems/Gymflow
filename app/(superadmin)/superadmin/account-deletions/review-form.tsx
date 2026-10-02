'use client';

import { useActionState } from 'react';
import { reviewAccountDeletion } from '@/lib/actions/account-deletion';
import type { AccountDeletionQueueRow } from '@/lib/account-deletion';

export function DeletionReviewForm({ request }: { request: AccountDeletionQueueRow }) {
  const [state, action, pending] = useActionState(reviewAccountDeletion, { ok: false, error: null });
  if (request.status === 'completed') return null;
  return <form action={action} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
    <input type="hidden" name="request_id" value={request.id} />
    <input type="hidden" name="expected_status" value={request.status} />
    <input type="hidden" name="status" value={request.status === 'pending' ? 'processing' : 'completed'} />
    {request.status === 'processing' && <>
      <p>Complete the documented erasure procedure first. This button only records completion; it does not erase data or cancel billing.</p>
      <label><input type="checkbox" name="erasure_completed" required /> Account access, renewals and non-retained personal data have actually been removed.</label>
      <label><input type="checkbox" name="confirmation_sent" required /> Completion and any retained records have been confirmed to the person.</label>
      <label>Evidence reference (no personal data)<input className="gf-input" name="completion_reference" minLength={5} maxLength={300} required placeholder="Restricted case or work record reference" /></label>
      <label>Retained records and retention basis<textarea className="gf-input" name="retention_summary" minLength={5} maxLength={1000} required placeholder="Categories and retention decision, or Nothing retained. Do not copy personal data." /></label>
    </>}
    <button className="gf-btn gf-btn-secondary gf-btn-sm" type="submit" disabled={pending}>{pending ? 'Saving…' : request.status === 'pending' ? 'Start processing' : 'Record completed deletion'}</button>
    {state.error && <p role="alert" style={{ color: 'var(--gf-danger)' }}>{state.error}</p>}
    {state.ok && <p role="status">{state.message}</p>}
  </form>;
}
