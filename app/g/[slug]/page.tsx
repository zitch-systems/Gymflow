import type { CSSProperties } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, LogIn, UserPlus, Dumbbell, MapPin } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Gym = {
  id: string; name: string; slug: string; logo_url: string | null; tagline: string | null;
  hero_image_url: string | null; brand_color: string | null; description: string | null; city: string | null;
};

async function loadGym(slug: string): Promise<Gym | null> {
  // `select('*')` rather than a column list: the generated types are stale for
  // brand_color, so a typed projection fails to compile. The row is a single
  // gym; over-fetch is negligible. gyms are publicly readable, but prefer the
  // admin client so this still works if that RLS ever tightens.
  try {
    const admin = createAdminClient();
    const { data } = await admin.from('gyms').select('*').eq('slug', slug).maybeSingle();
    if (data) return data as unknown as Gym;
  } catch {
    // no service-role key in this env — fall through to the anon client
  }
  const supabase = await createClient();
  const { data } = await supabase.from('gyms').select('*').eq('slug', slug).maybeSingle();
  return data ? (data as unknown as Gym) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gym = await loadGym(slug);
  if (!gym) return { title: 'Gym not found' };
  return {
    title: `${gym.name} — Members`,
    description: gym.tagline || `Sign in or join ${gym.name}. Check in, book classes and manage your membership.`,
  };
}

export default async function GymLanding({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gym = await loadGym(slug);
  if (!gym) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const brand = gym.brand_color;
  const style: CSSProperties | undefined = brand
    ? ({
        '--gf-brand': brand,
        '--gf-brand-light': `color-mix(in srgb, ${brand} 72%, white)`,
        '--gf-brand-dark': `color-mix(in srgb, ${brand} 78%, black)`,
        '--gf-brand-soft': `color-mix(in srgb, ${brand} 14%, transparent)`,
        '--gf-brand-glow': `color-mix(in srgb, ${brand} 32%, transparent)`,
      } as CSSProperties)
    : undefined;

  return (
    <main className="gymland" style={style}>
      {gym.hero_image_url && (
        // eslint-disable-next-line @next/next/no-img-element -- per-gym remote hero image
        <img className="gymland-bg" src={gym.hero_image_url} alt="" aria-hidden />
      )}
      <div className="gymland-card">
        <span className="gymland-logo">
          {gym.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- per-gym remote logo
            <img src={gym.logo_url} alt={gym.name} />
          ) : (
            <Dumbbell strokeWidth={1.9} />
          )}
        </span>

        <h1 className="gymland-name">{gym.name}</h1>
        {gym.city && <p className="gymland-loc"><MapPin size={14} strokeWidth={2} /> {gym.city}</p>}
        <p className="gymland-tag">{gym.tagline || gym.description || 'Check in, book classes and manage your membership — all from your phone.'}</p>

        {user ? (
          <div className="gymland-cta">
            <Link href="/launch" className="gf-btn gf-btn-primary gf-btn-lg gf-btn-full">
              Go to your dashboard <ArrowRight strokeWidth={2} style={{ width: 17, height: 17 }} />
            </Link>
            <p className="gymland-alt">Signed in as {user.email}.</p>
          </div>
        ) : (
          <div className="gymland-cta">
            <Link href="/login" className="gf-btn gf-btn-primary gf-btn-lg gf-btn-full">
              <LogIn strokeWidth={2} style={{ width: 17, height: 17 }} /> Sign in
            </Link>
            <Link href={`/join/${gym.slug}`} className="gf-btn gf-btn-secondary gf-btn-lg gf-btn-full">
              <UserPlus strokeWidth={2} style={{ width: 17, height: 17 }} /> Join {gym.name}
            </Link>
            <p className="gymland-alt">Members and staff sign in here. New here? Join to create your account.</p>
          </div>
        )}
      </div>

      <a className="gymland-by" href="https://gymflow.ng" target="_blank" rel="noreferrer">Powered by <strong>GymFlow</strong></a>
    </main>
  );
}
