// Helper for the dunning / reminder send paths to respect the
// notification_email / notification_whatsapp flags on profiles. Transactional
// sends (receipts, welcome) ignore these — only promotional channels honour
// them per the 20260529_member_notification_prefs.sql migration comment.
//
// Callers pass the joined profile object from their cron query; we check the
// relevant flag with a default-true fallback so a profile without the columns
// (preview branches whose DB hasn't been migrated yet) still gets the send.

export type ProfileWithPrefs = {
  notification_email?: boolean | null;
  notification_whatsapp?: boolean | null;
} | null | undefined;

export function respectsEmail(profile: ProfileWithPrefs): boolean {
  // Missing column → default to opted-in. Existing rows pre-migration have
  // no value, and the column default is `true` post-migration.
  return profile?.notification_email !== false;
}

export function respectsWhatsapp(profile: ProfileWithPrefs): boolean {
  return profile?.notification_whatsapp !== false;
}
