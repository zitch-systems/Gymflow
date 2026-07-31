import type { CSSProperties } from 'react';
import type { Metadata, Route } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { ArrowLeft, Globe2, ScanLine } from 'lucide-react';
import { PrintQrButton } from '@/components/gym/print-qr-button';
import { LogoMark } from '@/components/ui/logo';
import { accentVars } from '@/lib/accent';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { ROOT_DOMAIN } from '@/lib/tenant';
import './print-qr.css';

export const metadata: Metadata = {
  title: 'Print QR poster',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type PrintType = 'signup' | 'signin' | 'payment' | 'checkin';
type PrintableGym = {
  name: string;
  slug: string;
  logo_url: string | null;
  status: string | null;
  accent_color: string | null;
  accent_ink: string | null;
};

const QR_OPTS = {
  margin: 2,
  width: 1536,
  errorCorrectionLevel: 'M' as const,
  color: { dark: '#090b0a', light: '#ffffff' },
};

const isPrintType = (value: string | undefined): value is PrintType =>
  value === 'signup' || value === 'signin' || value === 'payment' || value === 'checkin';

async function loadGym(slug: string): Promise<PrintableGym | null> {
  let gym: PrintableGym | null = null;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('gyms')
      .select('name, slug, logo_url, status, accent_color, accent_ink')
      .eq('slug', slug)
      .maybeSingle();
    gym = data as PrintableGym | null;
  } catch {
    const supabase = await createClient();
    const { data } = await supabase
      .from('gyms')
      .select('name, slug, logo_url, status, accent_color, accent_ink')
      .eq('slug', slug)
      .maybeSingle();
    gym = data as PrintableGym | null;
  }
  return !gym || gym.status === 'suspended' ? null : gym;
}

function posterCopy(type: PrintType, gymName: string) {
  switch (type) {
    case 'signin':
      return {
        label: 'Member sign-in',
        eyebrow: 'Already a member?',
        title: `Sign in to ${gymName}`,
        description: 'Scan the code to securely access your membership, classes and gym account.',
      };
    case 'payment':
      return {
        label: 'Membership payment',
        eyebrow: 'Keep your training moving',
        title: 'Pay or renew in seconds',
        description: `Scan to choose a plan and complete your ${gymName} membership payment online.`,
      };
    case 'checkin':
      return {
        label: 'Door check-in',
        eyebrow: 'Welcome back',
        title: `Check in at ${gymName}`,
        description: 'Open your camera, scan the code and confirm your arrival before you train.',
      };
    default:
      return {
        label: 'New member sign-up',
        eyebrow: 'Your next session starts here',
        title: `Join ${gymName}`,
        description: 'Scan the code to create your account, choose a membership and start training.',
      };
  }
}

function targetFor(type: PrintType, origin: string, slug: string) {
  if (type === 'signin') return `${origin}/login`;
  if (type === 'payment') return `${origin}/dashboard/renew`;
  if (type === 'checkin') return `${origin}/checkin?via=qr`;
  return `${origin}/join/${slug}`;
}

export default async function PrintQrPoster({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const gym = await loadGym(slug);
  if (!gym) notFound();

  const requestedType = Array.isArray(query.type) ? query.type[0] : query.type;
  const type: PrintType = isPrintType(requestedType) ? requestedType : 'signup';
  const origin = `https://${gym.slug}.${ROOT_DOMAIN}`;
  const landingUrl = `${origin}/`;
  const targetUrl = targetFor(type, origin, gym.slug);
  const qrDataUrl = await QRCode.toDataURL(targetUrl, QR_OPTS);
  const copy = posterCopy(type, gym.name);
  const style = accentVars(gym.accent_color, gym.accent_ink) as unknown as CSSProperties;
  const initial = (gym.name.trim()[0] ?? 'G').toUpperCase();

  return (
    <main className="qr-print-shell" style={style}>
      <nav className="qr-print-toolbar" aria-label="Print poster controls">
        <Link href={`/g/${gym.slug}` as Route} className="qr-print-back">
          <ArrowLeft aria-hidden="true" strokeWidth={2} />
          Back to gym page
        </Link>
        <PrintQrButton />
      </nav>

      <article className={`qr-poster qr-poster-${type}`} aria-label={`${copy.label} poster for ${gym.name}`}>
        <div className="qr-poster-accent" aria-hidden="true" />

        <header className="qr-poster-header">
          <div className="qr-gym-brand">
            <span className={gym.logo_url ? 'qr-gym-logo has-logo' : 'qr-gym-logo'}>
              {gym.logo_url ? (
                <Image src={gym.logo_url} alt={`${gym.name} logo`} width={160} height={160} priority />
              ) : initial}
            </span>
            <span className="qr-gym-name">{gym.name}</span>
          </div>
          <span className="qr-poster-kind">{copy.label}</span>
        </header>

        <section className="qr-poster-copy">
          <p className="qr-poster-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </section>

        <section className="qr-code-section" aria-label="QR code">
          <div className="qr-code-frame">
            <span className="qr-corner qr-corner-a" aria-hidden="true" />
            <span className="qr-corner qr-corner-b" aria-hidden="true" />
            <span className="qr-corner qr-corner-c" aria-hidden="true" />
            <span className="qr-corner qr-corner-d" aria-hidden="true" />
            <Image
              className="qr-code-image"
              src={qrDataUrl}
              alt={`${copy.label} QR code for ${gym.name}`}
              width={1536}
              height={1536}
              unoptimized
              priority
            />
          </div>
          <p className="qr-scan-label"><ScanLine aria-hidden="true" strokeWidth={2} /> Scan with your phone camera</p>
        </section>

        <section className="qr-landing-url" aria-label="Gym landing page URL">
          <Globe2 aria-hidden="true" strokeWidth={2} />
          <span><small>Gym website</small><strong>{landingUrl}</strong></span>
        </section>

        <footer className="qr-poster-footer">
          <span>Powered by</span>
          <span className="qr-gymflow-lockup"><LogoMark size={28} /><strong>Gym<em>Flow</em></strong></span>
        </footer>
      </article>
    </main>
  );
}
