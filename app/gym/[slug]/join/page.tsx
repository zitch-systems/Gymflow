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

  return (
    <div className="join-wrap">
      <header className="gf-header">
        <div className="flex items-center gap-3">
          <div className="gym-avatar gym-avatar-sm" aria-hidden>
            {gym?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={gym.logo_url}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
              />
            ) : (
              (gym?.name?.charAt(0) ?? 'G').toUpperCase()
            )}
          </div>
          <div>
            <div className="join-header-title">{gym ? gym.name : 'Join GymFlow'}</div>
            <div className="join-header-subtitle">Member Registration</div>
          </div>
        </div>
        <Link href="/login" className="join-signin-link">
          Sign In
        </Link>
      </header>

      <JoinForm gymSlug={slug} />

      <ThemeToggleButton />
    </div>
  );
}
