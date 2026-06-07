import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { SettingsClient } from './settings-client';

export const metadata = { title: 'Settings' };

export default async function AdminSettings() {
  const { gym } = await requireStaff();
  const supabase = await createClient();
  const { count } = await supabase
    .from('gym_staff_links')
    .select('id', { count: 'exact', head: true })
    .eq('gym_id', gym.id).eq('is_active', true);

  return (
    <SettingsClient
      gym={{ name: gym.name, slug: gym.slug, phone: gym.phone, email: gym.email, address: gym.address }}
      staffCount={count ?? 0}
    />
  );
}
