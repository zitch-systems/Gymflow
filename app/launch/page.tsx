import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { provisionOwner } from '@/lib/provision';
import { healJoin } from '@/lib/actions/join';
import { sa } from '@/lib/superadmin-path';
import { gymLaunchUrl, memberBelongsOnGymSite } from '@/lib/web-signin';
import { FinishSetup } from './finish-setup';

// Post-login role router. signIn redirects here after a successful sign-in.
// Uses ONE Supabase client for both auth and the role lookups so the queries
// run in the same authenticated context as getUser — a second client instance
// came back empty, which is why role routing failed when done inside signIn.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function Launch() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: pa }, { data: staffLinks }, { data: member }] = await Promise.all([
    supabase.from('platform_admins').select('id').eq('user_id', user.id).eq('is_active', true).maybeSingle(),
    // ALL active staff links, not .maybeSingle(): a multi-gym owner/manager has
    // several rows, which made .maybeSingle() error (→ null) and drop them out of
    // the staff branch entirely — landing them on the member portal, or all the
    // way through to the "name your gym" onboarding form. Route to the admin
    // console if ANY link is a non-instructor role; a pure instructor gets /coach.
    supabase.from('gym_staff_links').select('role').eq('user_id', user.id).eq('is_active', true),
    // gyms(slug) rides along: a member on the platform's website is sent to
    // their own gym's page, and this is the query that already knows which gym.
    supabase.from('gym_member_links').select('id, gyms(slug)').eq('user_id', user.id).eq('is_active', true)
      .order('joined_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  // The console's URL is configured per deployment, so this is the one place a
  // platform admin learns it — and only after they've proved they are one.
  if (pa) redirect(sa());
  const staffRoles = ((staffLinks ?? []) as { role: string | null }[]).map((l) => l.role);
  if (staffRoles.length > 0) redirect(staffRoles.some((r) => r && r !== 'instructor') ? '/admin' : '/coach');

  if (member) {
    // Members belong on their gym's page, not on GymFlow's website. This covers
    // the sessions signIn never sees — a /join invite completed on the apex, a
    // confirmation link, a password reset. Target is the gym's own /launch, so
    // a browser that already holds a session there lands on the dashboard
    // rather than being asked to sign in twice.
    const memberSlug = (member as { gyms?: { slug?: string | null } | null }).gyms?.slug ?? null;
    const host = (await headers()).get('x-forwarded-host') ?? (await headers()).get('host');
    if (memberBelongsOnGymSite(host, { isPlatformAdmin: false, isStaff: false, memberGymSlug: memberSlug })) {
      redirect(gymLaunchUrl(memberSlug));
    }
    redirect('/dashboard');
  }

  // No role anywhere: an account whose provisioning failed (or predates it).
  // Previously this fell through to /dashboard, whose gate bounced back to
  // /login — an infinite loop with no explanation. Heal from the signup
  // breadcrumbs: a member who joined via an invite link gets re-linked to that
  // gym; an owner signup gets their gym provisioned from the name they typed;
  // anyone else gets the one-field setup form.
  const meta = (user.user_metadata as Record<string, unknown> | null) ?? {};
  const joinSlug = String(meta.join_gym_slug ?? '').trim();
  const joinPhone = meta.phone != null ? String(meta.phone) : null;
  if (joinSlug && (await healJoin(user.id, user.email ?? '', joinSlug, joinPhone))) redirect('/dashboard');

  const gymName = String(meta.gym_name ?? '').trim();
  if (gymName) {
    const prov = await provisionOwner({ userId: user.id, email: user.email ?? '', gymName });
    if (prov.ok) redirect('/admin');
  }

  return <FinishSetup defaultGymName={gymName} />;
}
