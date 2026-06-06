import { headers } from 'next/headers';

type PageProps = { searchParams: Promise<{ slug?: string }> };

export default async function SignupDonePage({ searchParams }: PageProps) {
  const { slug } = await searchParams;

  // Link to the gym's login. On the real apex/subdomain deployment that's
  // {slug}.gymflow.ng/login; on the bare Vercel domain (no wildcard yet) the
  // subdomain doesn't resolve, so use the same-origin /gym/{slug}/login path.
  const host = (await headers()).get('host') ?? '';
  const onGymflowDomain = host === 'gymflow.ng' || host === 'www.gymflow.ng' || host.endsWith('.gymflow.ng');
  const loginHref = slug
    ? onGymflowDomain
      ? `https://${slug}.gymflow.ng/login`
      : `/gym/${slug}/login`
    : '/login';

  return (
    <div className="login-wrap" style={{ maxWidth: 560, textAlign: 'center' }}>
      <div className="success-msg show" style={{ marginBottom: 24, display: 'inline-flex' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Payment successful
      </div>
      <h1 className="login-title">Your gym is live</h1>
      <p className="login-subtitle" style={{ marginBottom: 32 }}>
        We&apos;ve emailed your temporary password (check your inbox & WhatsApp). Click below to sign in to your admin
        portal.
      </p>
      {slug && (
        <a href={loginHref} className="gf-btn gf-btn-primary gf-btn-lg" style={{ display: 'inline-flex' }}>
          Sign in to {slug}
        </a>
      )}
      <p className="login-footer" style={{ marginTop: 32 }}>
        Need help? <a href="mailto:hello@gymflow.ng">hello@gymflow.ng</a>
      </p>
    </div>
  );
}
