import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { UserPlus, LogIn, CreditCard, Download, Printer } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';

export const metadata = { title: 'Member QR codes' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const QR_OPTS = { margin: 2, width: 1024, errorCorrectionLevel: 'M' as const, color: { dark: '#0a0b0e', light: '#ffffff' } };

// Three member QR codes — sign up, sign in, and payment — each encoding the
// matching gym link. Print them at the front desk or share online.
export default async function AdminInvite() {
  const { gym } = await requireStaff();

  const h = await headers();
  const host = h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || (host ? `${proto}://${host}` : '');

  const codes = [
    { key: 'signup', icon: UserPlus, label: 'Sign up', sub: 'New members create an account', url: `${origin}/join/${gym.slug}` },
    { key: 'signin', icon: LogIn, label: 'Sign in', sub: 'Returning members log in', url: `${origin}/login` },
    { key: 'payment', icon: CreditCard, label: 'Payment', sub: 'Pick a plan & pay with Paystack', url: `${origin}/dashboard/renew` },
  ];
  const pngs = await Promise.all(codes.map((c) => QRCode.toDataURL(c.url, QR_OPTS)));

  return (
    <>
      <div className="page-h">
        <div><h1>Member QR codes</h1><p>Three codes for sign-up, sign-in &amp; payment at {gym.name}.</p></div>
      </div>

      <div className="qr-grid">
        {codes.map((c, i) => {
          const Icon = c.icon;
          return (
            <div className="panel qr-card" key={c.key}>
              <div className="qr-card-h">
                <span className="ic" style={{ background: 'var(--gf-brand-soft)', color: 'var(--gf-brand)' }}><Icon strokeWidth={1.9} /></span>
                <div className="m"><strong>{c.label}</strong><small>{c.sub}</small></div>
              </div>
              <div className="qr-box">
                {/* eslint-disable-next-line @next/next/no-img-element -- generated data-URL QR */}
                <img src={pngs[i]} alt={`${c.label} QR for ${gym.name}`} width={200} height={200} />
              </div>
              <div className="qr-url">{c.url}</div>
              <a className="gf-btn gf-btn-secondary gf-btn-sm gf-btn-full" href={pngs[i]} download={`gymflow-${gym.slug}-${c.key}-qr.png`} style={{ textDecoration: 'none' }}>
                <Download strokeWidth={2} size={15} /> Download
              </a>
            </div>
          );
        })}
      </div>

      <div className="panel" style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--gf-text-secondary)', fontSize: '0.88rem' }}>
        <Printer strokeWidth={1.9} size={18} style={{ flexShrink: 0, color: 'var(--gf-brand)' }} />
        <span>Print the codes for your front desk, or share them on WhatsApp &amp; Instagram. Sign-up links members to {gym.name}; sign-in and payment send returning members straight to their dashboard and checkout.</span>
      </div>
    </>
  );
}
