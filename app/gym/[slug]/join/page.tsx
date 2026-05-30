import Link from 'next/link';
import { ThemeToggleButton } from '@/lib/theme';
import { getGymBySlug } from '@/lib/auth/gym';
import { JoinForm } from './join-form';

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function JoinPage({ params }: PageProps) {
  const { slug } = await params;
  const gym = await getGymBySlug(slug);
  const gymName = gym?.name ?? 'GymFlow';

  return (
    <div className="join-wrap">
      <nav className="join-nav" aria-label="Top">
        <Link href="/" className="join-back" aria-label={`Back to ${gymName}`}>
          {gym?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={gym.logo_url} alt="" className="join-nav-logo" />
          ) : (
            <span className="join-nav-mark" aria-hidden>{gymName.charAt(0).toUpperCase()}</span>
          )}
          <span className="join-nav-label">{gymName}</span>
        </Link>
        <Link href="/login" className="join-signin-link">
          Already a member? <strong>Sign in</strong>
        </Link>
      </nav>

      <header className="join-hero">
        <h1 className="join-hero-title">Welcome to {gymName}</h1>
        <p className="join-hero-sub">
          Set up your membership in two minutes — we&apos;ll keep you signed in afterwards.
        </p>
      </header>

      <JoinForm gymSlug={slug} />

      <ThemeToggleButton />
    </div>
  );
}
