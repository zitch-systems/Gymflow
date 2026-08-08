import { requireStaff, MANAGER_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { listBanks, type Bank } from '@/lib/paystack';
import { cacCertificateUrl } from '@/lib/actions/gym';
import { SettingsClient } from './settings-client';

export const metadata = { title: 'Settings' };

// Load the Paystack bank list defensively — a network blip or missing key
// shouldn't wipe out the whole settings page (which was crashing to the app
// error boundary and blocking logo/accent saves).
async function safeListBanks(): Promise<Bank[]> {
  try {
    return await listBanks();
  } catch (e) {
    console.error('[settings] listBanks failed', e);
    return [];
  }
}

// The onboarding banner links here with ?onboarding=<section> — open that
// settings tab directly instead of always landing on the profile tab.
const SETTINGS_SECTIONS = new Set(['profile', 'branding', 'hours', 'membership', 'payouts', 'notif', 'backups', 'integ', 'team']);

export default async function AdminSettings({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const requested = String(sp.onboarding ?? sp.section ?? '');
  const initialSection = SETTINGS_SECTIONS.has(requested) ? requested : 'profile';
  const { gym } = await requireStaff(MANAGER_ROLES);
  const supabase = await createClient();
  const [{ count }, banks, { data: hoursRows }, { data: payoutRows }] = await Promise.all([
    supabase.from('gym_staff_links')
      .select('id', { count: 'exact', head: true })
      .eq('gym_id', gym.id).eq('is_active', true),
    safeListBanks(),
    supabase.from('business_hours').select('day_of_week, open_time, close_time, is_closed, session').eq('gym_id', gym.id),
    supabase.from('gym_payout_accounts' as never)
      .select('id, bank_name, bank_code, account_number, account_name, verified, is_active')
      .eq('gym_id', gym.id).order('is_active', { ascending: false }).order('created_at', { ascending: true }),
  ]);

  // Backup history. The list is the evidence the schedule is being kept, so a
  // read failure shows an empty list rather than taking the settings page down
  // with it — the same defensive posture as the bank list above.
  const { data: backupRows } = await supabase
    .from('gym_backups' as never)
    .select('id, created_at, size_bytes, status, trigger, error, row_counts')
    .eq('gym_id', gym.id)
    .order('created_at', { ascending: false })
    .limit(10);
  const backups = ((backupRows as unknown as {
    id: string; created_at: string; size_bytes: number | null; status: string;
    trigger: string; error: string | null; row_counts: Record<string, number> | null;
  }[]) ?? []).map((b) => ({
    id: b.id,
    created_at: b.created_at,
    size_bytes: b.size_bytes,
    status: b.status,
    trigger: b.trigger,
    error: b.error,
    rows: Object.values(b.row_counts ?? {}).reduce((n, v) => n + (Number(v) || 0), 0),
  }));

  // Signed per view (10 minutes) rather than stored: the URL IS the read
  // capability for a private document, so it should outlive this page by as
  // little as possible. Null when the gym hasn't uploaded a certificate.
  const cacUrl = await cacCertificateUrl((gym as { cac_certificate_path?: string | null }).cac_certificate_path);

  const payoutAccounts = ((payoutRows as unknown as {
    id: string; bank_name: string; bank_code: string; account_number: string;
    account_name: string; verified: boolean; is_active: boolean;
  }[]) ?? []);

  // Default-open weekdays / shorter weekends when a gym hasn't set hours yet.
  // Each day can now carry multiple rows (one per session); default to a single
  // "all-day" row if the gym has no hours saved.
  type Row = { day_of_week: number; open_time: string; close_time: string; is_closed: boolean; session: 'all' | 'morning' | 'afternoon' | 'evening' };
  const byDay = new Map<number, Row[]>();
  for (const r of (hoursRows ?? []) as unknown as { day_of_week: number; open_time: string | null; close_time: string | null; is_closed: boolean | null; session?: string | null }[]) {
    const row: Row = {
      day_of_week: r.day_of_week,
      open_time: (r.open_time ?? '05:00').slice(0, 5),
      close_time: (r.close_time ?? '22:00').slice(0, 5),
      is_closed: !!r.is_closed,
      session: (r.session as Row['session']) ?? 'all',
    };
    const list = byDay.get(r.day_of_week) ?? [];
    list.push(row);
    byDay.set(r.day_of_week, list);
  }
  const hours: Row[] = [];
  for (let d = 0; d < 7; d++) {
    const rows = byDay.get(d);
    if (rows && rows.length) { hours.push(...rows); continue; }
    const weekend = d === 0 || d === 6;
    hours.push({
      day_of_week: d,
      open_time: weekend ? '07:00' : '05:00',
      close_time: weekend ? '20:00' : '22:00',
      is_closed: false,
      session: 'all',
    });
  }

  return (
    <SettingsClient
      banks={banks}
      // Signed here, in the server component: the URL is a capability with a
      // ten-minute life, so it's minted per page view rather than stored.
      cacUrl={cacUrl}
      hours={hours}
      initialSection={initialSection}
      payoutAccounts={payoutAccounts}
      backups={backups}
      gym={{
        name: gym.name, slug: gym.slug, phone: gym.phone, email: gym.email, address: gym.address,
        member_code: (gym as { member_code?: string | null }).member_code ?? null,
        tagline: (gym as { tagline?: string | null }).tagline ?? null,
        description: (gym as { description?: string | null }).description ?? null,
        city: (gym as { city?: string | null }).city ?? null,
        state: (gym as { state?: string | null }).state ?? null,
        website: (gym as { website?: string | null }).website ?? null,
        amenities: (gym as { amenities?: string[] | null }).amenities ?? null,
        social_links: (gym as { social_links?: Record<string, string> | null }).social_links ?? null,
        gallery_urls: (gym as { gallery_urls?: string[] | null }).gallery_urls ?? null,
        instagram_posts: (gym as { instagram_posts?: string[] | null }).instagram_posts ?? null,
        integrations: (gym as { integrations?: Record<string, string> | null }).integrations ?? null,
        // 'weekly' rather than 'off' when the column is absent: it matches the
        // database default, so a gym that has never touched the setting sees the
        // schedule that is actually running for them.
        backup_frequency: (gym as { backup_frequency?: string | null }).backup_frequency ?? 'weekly',
        backup_email: (gym as { backup_email?: boolean | null }).backup_email !== false,
        backup_last_run_at: (gym as { backup_last_run_at?: string | null }).backup_last_run_at ?? null,
        brand_color: (gym as { brand_color?: string | null }).brand_color ?? null,
        logo_url: (gym as { logo_url?: string | null }).logo_url ?? null,
        bank_name: gym.bank_name, bank_code: gym.bank_code, account_number: gym.account_number, account_name: gym.account_name,
        payouts_connected: !!gym.paystack_subaccount_code,
        payouts_locked: (gym as { payouts_locked?: boolean }).payouts_locked ?? false,
        commission_pct: gym.platform_commission_pct ?? 0,
        member_freeze_enabled: (gym as { member_freeze_enabled?: boolean }).member_freeze_enabled !== false,
        notif_class_reminders:    (gym as { notif_class_reminders?: boolean }).notif_class_reminders !== false,
        notif_renewal_nudges:     (gym as { notif_renewal_nudges?: boolean }).notif_renewal_nudges !== false,
        notif_payment_receipts:   (gym as { notif_payment_receipts?: boolean }).notif_payment_receipts !== false,
        notif_membership_updates: (gym as { notif_membership_updates?: boolean }).notif_membership_updates !== false,
        cac_number: (gym as { cac_number?: string | null }).cac_number ?? null,
        // `!== false` like the rest: a gym row that predates the column reads
        // as required, which is the same default the sign-in check applies.
        two_factor_required: (gym as { two_factor_required?: boolean }).two_factor_required !== false,
      }}
      staffCount={count ?? 0}
      providers={{
        // Real configuration state — the client badge renders exactly this.
        paystack: Boolean(process.env.PAYSTACK_SECRET_KEY),
        termii: Boolean(process.env.TERMII_API_KEY),
        resend: Boolean(process.env.RESEND_API_KEY),
      }}
    />
  );
}
