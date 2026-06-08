import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireMember, getProfile } from '@/lib/auth/dal';
import { MemberProfileForm } from '@/components/member/profile-form';

export const metadata = { title: 'Edit profile' };
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function EditProfile() {
  await requireMember();
  const profile = await getProfile();
  return (
    <section className="view on" data-v="edit-profile">
      <div className="mhead" style={{ paddingBottom: 8 }}>
        <Link href="/dashboard/profile" className="icon-btn" style={{ width: 38, height: 38 }} aria-label="Back to profile"><ArrowLeft strokeWidth={1.9} /></Link>
        <strong className="htitle">Edit profile</strong>
      </div>
      <MemberProfileForm profile={profile ?? {}} />
    </section>
  );
}
