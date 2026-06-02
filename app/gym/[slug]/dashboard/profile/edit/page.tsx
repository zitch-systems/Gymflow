import Link from 'next/link';
import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { ProfileForm } from '../profile-form';
import { ArrowLeft } from 'lucide-react';

export const metadata = { title: 'Personal details' };

type PageProps = { params: Promise<{ slug: string }> };

// notification_* columns ship in 20260529_member_notification_prefs.sql but may
// not exist on every preview branch's DB — read defensively.
type ProfileRow = {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  photo_url: string | null;
  notification_email?: boolean | null;
  notification_whatsapp?: boolean | null;
};

export default async function EditProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const { user } = await requireMember(slug);

  const supabase = await createClient();
  const { data: p } = await supabase
    .from('profiles')
    .select('full_name, first_name, last_name, email, phone, photo_url, notification_email, notification_whatsapp')
    .eq('id', user.id)
    .maybeSingle<ProfileRow>();

  const displayName = p?.full_name
    ?? [p?.first_name, p?.last_name].filter(Boolean).join(' ')
    ?? p?.email
    ?? 'Member';

  return (
    <div className="member-portal member-app">
      <header className="member-header">
        <div>
          <h1 className="gf-page-title">Personal details</h1>
          <p className="gf-page-subtitle">Update your contact info, photo and notifications.</p>
        </div>
        <Link href="/dashboard/profile" className="gf-btn gf-btn-ghost gf-btn-sm" aria-label="Back to settings">
          <ArrowLeft size={16} strokeWidth={1.75} /> Back
        </Link>
      </header>

      <Card>
        <div id="notifications" style={{ padding: 18 }}>
          <ProfileForm
            slug={slug}
            userId={user.id}
            email={p?.email ?? user.email ?? null}
            displayName={displayName}
            initial={{
              phone: p?.phone ?? null,
              photo_url: p?.photo_url ?? null,
              // Default to opted-in (matches the column default) if the
              // migration hasn't been applied yet for this gym's DB.
              notification_email: p?.notification_email ?? true,
              notification_whatsapp: p?.notification_whatsapp ?? true,
            }}
          />
        </div>
      </Card>
    </div>
  );
}
