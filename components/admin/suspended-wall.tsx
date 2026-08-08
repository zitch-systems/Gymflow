import { LogOut, ShieldAlert, Mail } from 'lucide-react';
import { signOut } from '@/lib/auth/actions';
import { supportAddress } from '@/lib/email/brand';

// Full-screen wall for a gym GymFlow has switched off (gyms.status =
// 'suspended' | 'terminated', set from /superadmin/gyms/[id]).
//
// Deliberately NOT the BillingWall: that one offers plan checkout because
// subscribing is the fix. A platform suspension is not something the gym can
// pay its way out of — the only route back is GymFlow support — so this wall
// offers contact, not a card form.
//
// Two audiences, because the same event reads completely differently depending
// on who hits it. Staff need to know their data is safe and who to call; a
// member needs to know the gym is unavailable and to talk to the gym, not to
// GymFlow — they have no relationship with us and no standing to resolve it.
export type SuspendedAudience = 'staff' | 'member';

export function SuspendedWall({ gymName, audience = 'staff' }: { gymName: string; audience?: SuspendedAudience }) {
  const staff = audience === 'staff';
  return (
    <div
      className={staff ? 'ds-admin' : 'ds-member'}
      style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '2rem' }}
    >
      <div style={{ width: '100%', maxWidth: 560, textAlign: 'center' }}>
        <div
          style={{
            width: 62, height: 62, borderRadius: 20, margin: '0 auto 18px',
            display: 'grid', placeItems: 'center',
            background: 'var(--gf-danger-soft)', color: 'var(--gf-danger)',
            border: '1px solid rgba(var(--gf-danger-rgb), 0.25)',
          }}
        >
          <ShieldAlert size={28} strokeWidth={1.8} />
        </div>
        {staff && <span className="pill-plat">GymFlow account</span>}
        <h1 style={{ margin: '10px 0 6px' }}>
          {staff ? `${gymName} is suspended` : `${gymName} is unavailable`}
        </h1>
        <p style={{ color: 'var(--gf-text-muted)', margin: '0 auto 22px' }}>
          {staff ? (
            <>
              This gym’s GymFlow account has been suspended by the platform, so the console and public page are
              offline. Nothing has been deleted — your members, classes and payment history are untouched.
              Get in touch and we’ll go through it with you.
            </>
          ) : (
            <>
              {gymName} isn’t using GymFlow at the moment, so bookings, check-ins and payments are paused here.
              Your membership and history are safe. Please get in touch with the gym directly — they’ll know
              more than we can tell you.
            </>
          )}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          {staff && (
            <a className="gf-btn gf-btn-primary" href={`mailto:${supportAddress()}?subject=${encodeURIComponent(`Suspended account — ${gymName}`)}`}>
              <Mail size={15} strokeWidth={1.9} /> Contact support
            </a>
          )}
          <form action={signOut}>
            <button type="submit" className="gf-btn gf-btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <LogOut size={15} strokeWidth={1.8} /> Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
