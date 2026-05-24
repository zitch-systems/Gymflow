import { requireStaff } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { LandingForm } from './landing-form';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

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
      <PageHeader
        title="Landing page"
        subtitle={
          <>
            Public page at{' '}
            <a className="gf-link" href={`https://${gym.slug}.gymflow.ng`} target="_blank" rel="noreferrer">
              {gym.slug}.gymflow.ng
            </a>
          </>
        }
        actions={
          <ButtonLink href="/admin/settings" variant="ghost" size="sm" leadingIcon={<ArrowLeft size={16} strokeWidth={1.75} />}>
            Back to settings
          </ButtonLink>
        }
      />

      <Card>
        <LandingForm slug={slug} gymId={gym.id} initial={full ?? {}} />
      </Card>
    </div>
  );
}
