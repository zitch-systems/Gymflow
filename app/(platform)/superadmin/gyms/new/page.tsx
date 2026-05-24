import { redirect } from 'next/navigation';
import { isPlatformAdmin, requireAuth } from '@/lib/auth/dal';
import { OnboardForm } from './onboard-form';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default async function SuperadminOnboardGymPage() {
  await requireAuth();
  if (!(await isPlatformAdmin())) redirect('/');

  return (
    <div className="gf-page">
      <PageHeader
        title="Onboard a gym manually"
        subtitle="No payment is recorded — use this for trial gyms or migrations."
        actions={
          <ButtonLink href="/superadmin" variant="ghost" size="sm" leadingIcon={<ArrowLeft size={16} strokeWidth={1.75} />}>
            Back
          </ButtonLink>
        }
      />

      <Card>
        <OnboardForm />
      </Card>
    </div>
  );
}
