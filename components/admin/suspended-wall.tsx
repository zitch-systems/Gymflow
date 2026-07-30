import { LogOut, ShieldAlert, Mail } from 'lucide-react';
import { signOut } from '@/lib/auth/actions';
import { supportAddress } from '@/lib/email/brand';

// Full-screen wall for a gym GymFlow has suspended (gyms.status = 'suspended',
// set from /superadmin/gyms/[id]).
//
// Deliberately NOT the BillingWall: that one offers plan checkout because
// subscribing is the fix. A platform suspension is not something the gym can
// pay its way out of — the only route back is GymFlow support — so this wall
// offers contact, not a card form.
export function SuspendedWall({ gymName }: { gymName: string }) {
  return (
    <div className="ds-admin" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '2rem' }}>
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
        <span className="pill-plat">GymFlow account</span>
        <h1 style={{ margin: '10px 0 6px' }}>{gymName} is suspended</h1>
        <p style={{ color: 'var(--gf-text-muted)', margin: '0 auto 22px' }}>
          This gym’s GymFlow account has been suspended by the platform, so the console and public page are
          offline. Nothing has been deleted — your members, classes and payment history are untouched.
          Get in touch and we’ll go through it with you.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a className="gf-btn gf-btn-primary" href={`mailto:${supportAddress()}?subject=${encodeURIComponent(`Suspended account — ${gymName}`)}`}>
            <Mail size={15} strokeWidth={1.9} /> Contact support
          </a>
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
