import { requireInstructor, getProfile } from '@/lib/auth/dal';
import { CoachSettingsClient } from './settings-client';

export const metadata = { title: 'Settings · Instructor' };

export default async function CoachSettings() {
  await requireInstructor();
  const profile = await getProfile();
  const name = profile?.full_name ?? profile?.email ?? 'Coach';

  return (
    <CoachSettingsClient
      profile={{
        full_name: profile?.full_name ?? '',
        specialisation: profile?.specialisation ?? '',
        bio: profile?.bio ?? '',
        initial: name.charAt(0).toUpperCase(),
        avatar_url: profile?.avatar_url ?? null,
      }}
    />
  );
}
