type PageProps = { searchParams: Promise<{ slug?: string }> };

export default async function SignupDonePage({ searchParams }: PageProps) {
  const { slug } = await searchParams;
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
        <a href={`https://${slug}.gymflow.ng/login`} className="gf-btn gf-btn-primary gf-btn-lg" style={{ display: 'inline-flex' }}>
          Open {slug}.gymflow.ng
        </a>
      )}
      <p className="login-footer" style={{ marginTop: 32 }}>
        Need help? <a href="mailto:hello@gymflow.ng">hello@gymflow.ng</a>
      </p>
    </div>
  );
}
