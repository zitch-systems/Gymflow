import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isPlatformAdmin, requireAuth } from '@/lib/auth/dal';
import { OnboardForm } from './onboard-form';

export default async function SuperadminOnboardGymPage() {
  await requireAuth();
  if (!(await isPlatformAdmin())) redirect('/');

  return (
    <div className="gf-page">
      <header className="gf-page-header">
        <div>
          <h1 className="gf-page-title">Onboard a gym manually</h1>
          <p className="gf-page-subtitle">No payment is recorded — use this for trial gyms or migrations.</p>
        </div>
        <Link href="/superadmin" className="gf-btn gf-btn-ghost gf-btn-sm">
          Back
        </Link>
      </header>

      <div className="gf-card">
        <OnboardForm />
      </div>
    </div>
  );
}
