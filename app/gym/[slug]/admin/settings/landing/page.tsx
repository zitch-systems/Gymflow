import Link from 'next/link';
import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { LandingForm } from './landing-form';

type PageProps = { params: Promise<{ slug: string }> };

export default async function AdminLandingSettingsPage({ params }: PageProps) {
  const { slug } = await params;
  const { gym } = await requireStaff(slug);

  const supabase = await createClient();
  const { data: full } = await supabase
    .from('gyms')
    .select('tagline, description, hero_image_url, address, phone, email, landing_enabled, landing_content')
    .eq('id', gym.id)
    .maybeSingle();

  return (
    <div className="gf-page">
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">Landing page</h1>
          <p className="gf-page-subtitle">
            Public page at{' '}
            <a className="gf-link" href={`https://${gym.slug}.gymflow.ng`} target="_blank" rel="noreferrer">
              {gym.slug}.gymflow.ng
            </a>
          </p>
        </div>
        <Link href="/admin/settings" className="gf-btn gf-btn-ghost gf-btn-sm">
          Back to settings
        </Link>
      </header>

      <div className="gf-card">
        <LandingForm slug={slug} gymId={gym.id} initial={full ?? {}} />
      </div>
    </div>
  );
}
