import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { listBanks } from '@/lib/paystack';
import { SettingsClient } from './settings-client';

export const metadata = { title: 'Settings' };

export default async function AdminSettings() {
  const { gym } = await requireStaff();
  const supabase = await createClient();
  const [{ count }, banks, { data: hoursRows }] = await Promise.all([
    supabase.from('gym_staff_links')
      .select('id', { count: 'exact', head: true })
      .eq('gym_id', gym.id).eq('is_active', true),
    listBanks(),
    supabase.from('business_hours').select('day_of_week, open_time, close_time, is_closed').eq('gym_id', gym.id),
  ]);

  // Default-open weekdays / shorter weekends when a gym hasn't set hours yet.
  const byDay = new Map((hoursRows ?? []).map((h) => [h.day_of_week, h]));
  const hours = Array.from({ length: 7 }, (_, d) => {
    const row = byDay.get(d);
    const weekend = d === 0 || d === 6;
    return {
      day_of_week: d,
      open_time: (row?.open_time ?? (weekend ? '07:00' : '05:00')).slice(0, 5),
      close_time: (row?.close_time ?? (weekend ? '20:00' : '22:00')).slice(0, 5),
      is_closed: row?.is_closed ?? false,
    };
  });

  return (
    <SettingsClient
      banks={banks}
      hours={hours}
      gym={{
        name: gym.name, slug: gym.slug, phone: gym.phone, email: gym.email, address: gym.address,
        tagline: (gym as { tagline?: string | null }).tagline ?? null,
        description: (gym as { description?: string | null }).description ?? null,
        city: (gym as { city?: string | null }).city ?? null,
        state: (gym as { state?: string | null }).state ?? null,
        website: (gym as { website?: string | null }).website ?? null,
        amenities: (gym as { amenities?: string[] | null }).amenities ?? null,
        brand_color: (gym as { brand_color?: string | null }).brand_color ?? null,
        logo_url: (gym as { logo_url?: string | null }).logo_url ?? null,
        bank_name: gym.bank_name, bank_code: gym.bank_code, account_number: gym.account_number, account_name: gym.account_name,
        payouts_connected: !!gym.paystack_subaccount_code,
        commission_pct: gym.platform_commission_pct ?? 0,
        member_freeze_enabled: (gym as { member_freeze_enabled?: boolean }).member_freeze_enabled !== false,
      }}
      staffCount={count ?? 0}
    />
  );
}
