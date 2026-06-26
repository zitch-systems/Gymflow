import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { UserPlus, LogIn, CreditCard, Download, Printer } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { InviteLinkButton } from '@/components/admin/invite-link';

export const metadata = { title: 'Invite QR' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Member onboarding QR: encodes the gym's public /join/<slug> link. A member
// scans it to create an account, sign in, and then renew/pay — all from one
// code the gym can print at the front desk or share online.
export default async function AdminInvite() {
  const { gym } = await requireStaff();

  const h = await headers();
  const host = h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || (host ? `${proto}://${host}` : '');
  const joinUrl = `${origin}/join/${gym.slug}`;

  // High-res PNG (displayed small, downloads/prints crisp). Dark modules on
  // white scan best.
  const png = await QRCode.toDataURL(joinUrl, { margin: 2, width: 1024, errorCorrectionLevel: 'M', color: { dark: '#0a0b0e', light: '#ffffff' } });

  const STEPS = [
    { icon: UserPlus, t: 'Create an account', s: 'New members land on your gym’s sign-up page, pre-linked to you.' },
    { icon: LogIn, t: 'Sign in', s: 'Returning members sign in and go straight to their dashboard.' },
    { icon: CreditCard, t: 'Pay / renew', s: 'From there they pick a plan and pay with Paystack — settled to your bank.' },
  ];

  return (
    <>
      <div className="page-h">
        <div><h1>Invite QR</h1><p>One code for members to join, sign in &amp; pay at {gym.name}.</p></div>
      </div>

      <div className="grid2" style={{ gridTemplateColumns: 'minmax(260px, 320px) 1fr', alignItems: 'start', gap: 16 }}>
        <div className="panel" style={{ textAlign: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 14, width: 'fit-content', margin: '0 auto', boxShadow: 'var(--gf-shadow-sm)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={png} alt={`Sign-up QR for ${gym.name}`} width={232} height={232} style={{ display: 'block', width: 232, height: 232 }} />
          </div>
          <div style={{ marginTop: 12, fontSize: '0.8rem', color: 'var(--gf-text-muted)', wordBreak: 'break-all' }}>{joinUrl}</div>
          <a href={`/g/${gym.slug}`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: '0.78rem', fontWeight: 600, color: 'var(--gf-brand)', textDecoration: 'none' }}>View your public page ↗</a>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 }}>
            <InviteLinkButton slug={gym.slug} />
            <a className="gf-btn gf-btn-primary gf-btn-sm" href={png} download={`gymflow-${gym.slug}-qr.png`} style={{ textDecoration: 'none' }}>
              <Download strokeWidth={2} size={15} /> Download QR
            </a>
          </div>
        </div>

        <div className="panel">
          <div className="panel-h"><div><h3>How members use it</h3><div className="sub">Scan → join → pay, in one flow</div></div></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {STEPS.map((step) => {
              const Icon = step.icon;
              return (
                <div className="mt" key={step.t}>
                  <div className="ic" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}><Icon strokeWidth={1.9} /></div>
                  <div className="m"><strong>{step.t}</strong><small>{step.s}</small></div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, padding: '12px 14px', borderRadius: 'var(--gf-radius-sm)', background: 'var(--gf-elevated)', color: 'var(--gf-text-secondary)', fontSize: '0.85rem' }}>
            <Printer strokeWidth={1.9} size={16} />
            <span>Download and print it for your front desk, or share the link on WhatsApp &amp; Instagram.</span>
          </div>
        </div>
      </div>
    </>
  );
}
