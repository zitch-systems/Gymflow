import Link from 'next/link';
import { CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import { requireAdminStaff } from '@/lib/auth/dal';
import { verifyTransaction } from '@/lib/paystack';
import { handlePlatformEvent } from '@/lib/platform-fulfill';

export const metadata = { title: 'Billing' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Paystack redirects here after the platform-subscription checkout. Deliberately
// OUTSIDE the (admin) route group: the admin layout's billing wall blocks every
// /admin/* route for a lapsed gym, which would otherwise block the very page that
// reactivates them. Gated directly with requireAdminStaff() instead. We verify and
// (idempotently) activate so it lands even without the webhook; the webhook stays
// authoritative and captures the recurring subscription/customer codes.
export default async function BillingCallback({ searchParams }: { searchParams: Promise<{ reference?: string; trxref?: string }> }) {
  const { gym } = await requireAdminStaff();
  const sp = await searchParams;
  const reference = sp.reference ?? sp.trxref ?? '';

  let ok = false;
  let msg = 'We couldn’t find this payment. If you were charged, it’ll reflect shortly.';
  if (reference) {
    const v = await verifyTransaction(reference);
    // Platform checkouts always stamp gym_id at init; a verified success whose
    // metadata is missing it (or points elsewhere) must not activate this gym.
    if (v.ok && v.status === 'success' && v.metadata?.gym_id !== gym.id) {
      msg = 'This payment reference belongs to a different gym.';
    } else if (v.ok && v.status === 'success') {
      const f = await handlePlatformEvent({
        event: 'charge.success',
        data: { reference: v.reference, amount: v.amountKobo, metadata: v.metadata, paid_at: new Date().toISOString() },
      });
      if (!f.ok) console.error(`[billing/callback] activate failed for ${v.reference}: ${f.error}`);
      ok = true;
      msg = 'Your GymFlow subscription is active. Thank you!';
    } else if (v.ok) {
      msg = `Payment status: ${v.status}. No charge was completed.`;
    } else {
      msg = v.error;
    }
  }

  return (
    <div className="ds-admin" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '2rem' }}>
      <div className="panel" style={{ maxWidth: 460, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8, color: ok ? 'var(--gf-success, #11d18b)' : 'var(--gf-danger, #ff4560)' }}>
          {ok ? <CheckCircle2 size={48} strokeWidth={1.7} /> : <XCircle size={48} strokeWidth={1.7} />}
        </div>
        <h2 style={{ margin: '0 0 6px' }}>{ok ? 'Subscription active' : 'Payment not completed'}</h2>
        <p style={{ color: 'var(--gf-text-muted)', margin: '0 0 18px' }}>{msg}</p>
        <Link href="/admin/billing" className="gf-btn gf-btn-primary gf-btn-full" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          Go to billing <ArrowRight size={17} strokeWidth={2} />
        </Link>
      </div>
    </div>
  );
}
