import Link from 'next/link';
import { ThemeToggleButton } from '@/lib/theme';
import { getGymBySlug } from '@/lib/auth/gym';
import { LogoMark } from '@/components/ui/logo';
import { LoginForm } from './login-form';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ welcome?: string; redirect?: string; reset?: string }>;
};

export default async function LoginPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const gym = await getGymBySlug(slug);

  return (
    <div className="login-wrap">
      <div className="login-header">
        <Link href="/" className="gf-logo gf-logo-lg" style={{ display: 'inline-flex', marginBottom: 16 }}>
          <LogoMark />
        </Link>

        <div className="gym-avatar">
          {gym?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={gym.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
          ) : (
            (gym?.name?.charAt(0) ?? 'G').toUpperCase()
          )}
        </div>
        <h1 className="login-title">{gym?.name ?? 'Welcome Back'}</h1>
        <p className="login-subtitle">Sign in to your membership portal</p>
      </div>

      {sp.welcome === '1' && (
        <div className="success-msg show" style={{ marginBottom: 16 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Account created! Sign in to continue.
        </div>
      )}
      {sp.reset === '1' && (
        <div className="success-msg show" style={{ marginBottom: 16 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Reset link sent — check your email.
        </div>
      )}

      <div className="login-card">
        <LoginForm redirectTo={sp.redirect ?? ''} slug={slug} />
      </div>

      <p className="login-footer">
        New member? <Link href="/join">Create account</Link>
      </p>

      <ThemeToggleButton />
    </div>
  );
}
