import { requireMember } from '@/lib/auth/gym';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/lib/auth/actions';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { QuickAction } from '@/components/ui/quick-action';
import { ProfileForm } from './profile-form';
import { CreditCard, Wallet, GraduationCap, LogOut } from 'lucide-react';

export const metadata = { title: 'Settings' };

type PageProps = { params: Promise<{ slug: string }> };

// The two notification-pref columns ship in the
// 20260529_member_notification_prefs.sql migration but may not exist yet in
// every preview branch's DB. Read defensively so the page still loads.
type ProfileRow = {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  notification_email?: boolean | null;
  notification_whatsapp?: boolean | null;
};

export default async function MemberProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const { user, gym } = await requireMember(slug);

  const supabase = await createClient();
  const { data: p } = await supabase
    .from('profiles')
    .select('full_name, first_name, last_name, email, phone, notification_email, notification_whatsapp')
    .eq('id', user.id)
    .maybeSingle<ProfileRow>();

  const displayName = p?.full_name
    ?? [p?.first_name, p?.last_name].filter(Boolean).join(' ')
    ?? p?.email
    ?? 'Member';

  return (
    <div className="member-portal">
      <PageHeader
        title="Settings"
        subtitle={`${displayName} · member of ${gym.name}`}
      />

      <section className="member-quick-actions">
        <QuickAction href="/dashboard/renew" icon={CreditCard} label="Renew" />
        <QuickAction href="/dashboard/cards" icon={Wallet} label="Cards" />
        <QuickAction href="/dashboard/instructors" icon={GraduationCap} label="Coaches" />
      </section>

      <Card>
        <CardHeader title="Account details" />
        <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--gf-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Name</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{displayName}</div>
            <div style={{ fontSize: 12, color: 'var(--gf-text-muted)' }}>Ask gym admin to change.</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--gf-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Email</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{p?.email ?? '—'}</div>
            <div style={{ fontSize: 12, color: 'var(--gf-text-muted)' }}>Sign-in email — contact support to change.</div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Edit" />
        <div style={{ padding: 18 }}>
          <ProfileForm
            slug={slug}
            initial={{
              phone: p?.phone ?? null,
              // Default to opted-in (matches the column default) if the
              // migration hasn't been applied yet for this gym's DB.
              notification_email: p?.notification_email ?? true,
              notification_whatsapp: p?.notification_whatsapp ?? true,
            }}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Account" />
        <div style={{ padding: 18 }}>
          <form action={signOut}>
            <button type="submit" className="gf-btn gf-btn-ghost gf-btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <LogOut size={16} strokeWidth={1.75} /> Sign out
            </button>
          </form>
        </div>
      </Card>
    </div>
  );
}
