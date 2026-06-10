import { requireInstructor, getProfile } from '@/lib/auth/dal';
import { CoachSettingsClient } from './settings-client';

export const metadata = { title: 'Settings · Instructor' };

export default async function CoachSettings() {
  await requireInstructor();
  const profile = await getProfile();
  const name = profile?.full_name ?? profile?.email ?? 'Coach';
  // availability is jsonb (number[]) added by the 20260610 migration — absent
  // until applied, so default to weekdays.
  const availability = Array.isArray((profile as { availability?: unknown } | null)?.availability)
    ? ((profile as { availability?: unknown }).availability as number[]).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : [1, 2, 3, 4, 5];

  return (
    <CoachSettingsClient
      profile={{
        full_name: profile?.full_name ?? '',
        specialisation: profile?.specialisation ?? '',
        bio: profile?.bio ?? '',
        initial: name.charAt(0).toUpperCase(),
        avatar_url: profile?.avatar_url ?? null,
        notification_email: profile?.notification_email ?? true,
        notification_whatsapp: profile?.notification_whatsapp ?? true,
        availability,
      }}
    />
  );
}
