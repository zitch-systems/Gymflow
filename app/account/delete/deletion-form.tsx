'use client';

import { useActionState } from 'react';
import { submitAccountDeletion, type DeletionState } from '@/lib/actions/account-deletion';

export function AccountDeletionForm({ authenticated, email, initial }: { authenticated: boolean; email: string | null; initial: DeletionState }) {
  const [state, action, pending] = useActionState(submitAccountDeletion, initial);
  return (
    <form action={action} style={{ display: 'grid', gap: 16 }}>
      <input type="hidden" name="mode" value={authenticated ? 'session' : 'credentials'} />
      {authenticated ? <p>Account: <strong>{email ?? 'Your signed-in account'}</strong></p> : <>
        <p>Verify the account you want to delete. This works even if your gym membership is inactive.</p>
        <label>Email<input className="gf-input" type="email" name="email" autoComplete="username" maxLength={254} required /></label>
        <label>Password<input className="gf-input" type="password" name="password" autoComplete="current-password" maxLength={1024} required /></label>
      </>}
      {state.request && <div role="status">
        <strong>{state.request.status === 'completed' ? 'Deletion completed' : state.request.status === 'processing' ? 'Deletion in progress' : 'Deletion requested'}</strong>
        <p>Requested {new Date(state.request.requested_at).toLocaleDateString('en-GB', { timeZone: 'UTC' })}. Target completion {new Date(state.request.due_at).toLocaleDateString('en-GB', { timeZone: 'UTC' })}.</p>
      </div>}
      <label>Type DELETE to confirm<input className="gf-input" name="confirmation" autoComplete="off" maxLength={6} placeholder="DELETE" /></label>
      <p style={{ fontSize: '0.9rem' }}>This requests deletion of your whole GymFlow account across all gyms, including personal data that we are not legally required to keep. It cannot be undone after processing.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <button className="gf-btn gf-btn-primary" type="submit" name="intent" value="request" disabled={pending}>{pending ? 'Please wait…' : 'Request account deletion'}</button>
        <button className="gf-btn gf-btn-secondary" type="submit" name="intent" value="status" disabled={pending}>Check request status</button>
      </div>
      {state.error && <p role="alert" style={{ color: 'var(--gf-danger)' }}>{state.error}</p>}
      {state.ok && state.message && <p role="status">{state.message}</p>}
    </form>
  );
}
