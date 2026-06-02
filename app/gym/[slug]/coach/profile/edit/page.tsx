import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader } from '@/components/ui/card';
import { ProfileForm } from '../profile-form';
import { ArrowLeft } from 'lucide-react';

export const metadata = { title: 'Public profile' };

type PageProps = { params: Promise<{ slug: string }> };

export default async function CoachProfileEditPage({ params }: PageProps) {
  const { slug } = await params;
  const { user } = await requireInstructor(slug);
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, phone, full_name, bio, specialisation, certifications, photo_url')
    .eq('id', user.id)
    .maybeSingle();

  return (
    <div className="member-portal member-app">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">Public profile</h1>
          <p className="gf-page-subtitle">What members see when they browse coaches.</p>
        </div>
        <Link href="/coach/profile" className="gf-btn gf-btn-ghost gf-btn-sm" aria-label="Back to profile">
          <ArrowLeft size={16} strokeWidth={1.75} /> Back
        </Link>
      </header>

      <Card>
        <CardHeader title="Your details" />
        <ProfileForm
          userId={user.id}
          slug={slug}
          initial={{
            full_name: profile?.full_name ?? null,
            email: profile?.email ?? null,
            phone: profile?.phone ?? null,
            bio: profile?.bio ?? null,
            specialisation: profile?.specialisation ?? null,
            certifications: profile?.certifications ?? null,
            photo_url: profile?.photo_url ?? null,
          }}
        />
      </Card>
    </div>
  );
}
