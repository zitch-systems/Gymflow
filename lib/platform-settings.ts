import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_PLATFORM_COMMISSION_PCT } from '@/lib/paystack';

// The platform's own defaults, read from the singleton platform_settings row.
//
// This exists because the same number had three answers: the code constant
// below (1), the gyms column default (5.00, which is what every live gym is
// actually on), and a hardcoded "3%" on the platform settings page that was
// wired to nothing. A platform operator reading their own console was told a
// commission rate GymFlow does not charge.
//
// The row is now the answer, and the constant is what happens when there is no
// row — a fresh local database, or a read that failed. Note which way that
// fallback leans: it is the CONSERVATIVE number, not the generous one. If this
// ever silently falls back, GymFlow under-charges itself rather than
// over-charging a gym that never agreed to it.

/* eslint-disable @typescript-eslint/no-explicit-any */
// platform_settings postdates lib/database.types.ts, the same reason the
// WhatsApp and two-factor tables are cast at their call sites.
type Db = SupabaseClient<any, any, any>;

export type PlatformSettings = {
  defaultCommissionPct: number;
  defaultTrialDays: number;
};

export const FALLBACK_SETTINGS: PlatformSettings = {
  defaultCommissionPct: DEFAULT_PLATFORM_COMMISSION_PCT,
  defaultTrialDays: 14,
};

/**
 * Read the platform defaults. Never throws: a provisioning run must not fail
 * because a settings read did, so an error or a missing row degrades to the
 * fallback above.
 */
export async function getPlatformSettings(db: Db): Promise<PlatformSettings> {
  try {
    const { data } = await db
      .from('platform_settings')
      .select('default_commission_pct, default_trial_days')
      .limit(1)
      .maybeSingle();
    if (!data) return FALLBACK_SETTINGS;

    const row = data as { default_commission_pct: number | string | null; default_trial_days: number | null };
    // numeric(5,2) arrives as a string from PostgREST.
    const pct = Number(row.default_commission_pct);
    const days = Number(row.default_trial_days);
    return {
      defaultCommissionPct: Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : FALLBACK_SETTINGS.defaultCommissionPct,
      defaultTrialDays: Number.isFinite(days) && days >= 0 && days <= 365 ? days : FALLBACK_SETTINGS.defaultTrialDays,
    };
  } catch {
    return FALLBACK_SETTINGS;
  }
}

/** When a gym provisioned now should stop being on trial. */
export function trialEndsAt(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}
