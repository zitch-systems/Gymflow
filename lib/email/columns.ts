// Column lists and row shapes shared by the email modules.
//
// Deliberately free of 'server-only' and of any Supabase-client import: the
// pure link/branding logic (lib/email/auth-hook.ts) needs these types and the
// column string, and it has to stay importable by the vitest suite, which runs
// outside any server context. recipients.ts (which IS server-only) re-exports
// everything here so existing importers don't change.

/** Columns branding + gating need. Mirrors what templates actually read. */
export const GYM_EMAIL_COLUMNS =
  'id, name, slug, email, phone, city, state, address, logo_url, brand_color, subscription_plan, '
  + 'notif_renewal_nudges, notif_payment_receipts, notif_class_reminders, notif_membership_updates';

export type EmailGym = {
  id: string;
  name: string | null;
  slug: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  logo_url: string | null;
  brand_color: string | null;
  subscription_plan: string | null;
  notif_renewal_nudges: boolean | null;
  notif_payment_receipts: boolean | null;
  notif_class_reminders: boolean | null;
  notif_membership_updates: boolean | null;
};

export type EmailContact = {
  id: string;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  /** profiles.notification_email — the member's own opt-out. */
  wantsEmail: boolean;
};
