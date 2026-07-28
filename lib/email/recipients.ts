import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/database.types';
import { GYM_EMAIL_COLUMNS, type EmailGym, type EmailContact } from './columns';

// Re-export so the many callers that import these from '@/lib/email/recipients'
// keep working; the definitions live in the server-only-free columns.ts.
export { GYM_EMAIL_COLUMNS };
export type { EmailGym, EmailContact };

type UserRole = Database['public']['Enums']['user_role'];

// Shared service-role lookups for "who do I mail, and what brand do I dress it
// in?". Before this module every send site re-derived these inline — the owner
// lookup in lib/payout-alerts.ts:54-67 was the only implementation, and each new
// send site was copying it.
//
// Service-role is required, not incidental: a manager cannot read the owner's
// staff link under RLS, and cron/webhook paths have no user session at all.
// Every function fails soft (null / empty array) so a lookup failure degrades to
// "no email sent" rather than throwing inside a payment webhook.

type Admin = ReturnType<typeof createAdminClient>;

/** Service-role client, or null when the key is absent (preview envs).
 *  createAdminClient throws by contract; email must never be the thing that
 *  takes a request down, so the throw is converted to a skip here. */
export function adminOrNull(): Admin | null {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

/**
 * Is this address on the suppression list (hard-bounced or complained)?
 *
 * The Resend webhook writes email_suppressions; this is the read that makes it
 * mean something. Enforced at the send choke point so we stop calling Resend for
 * an address we already know is dead — Resend would reject it anyway, but every
 * such attempt still counts against the shared domain's reputation, and a spam
 * *complaint* must stop us mailing that person even where Resend still would.
 *
 * Fails OPEN: a lookup error or missing table returns false (not suppressed), so
 * a suppression-check outage degrades to "we sent an email we could have
 * skipped", never to "we blocked a password reset".
 */
export async function isSuppressed(admin: Admin | null, address: string): Promise<boolean> {
  const addr = address.trim().toLowerCase();
  if (!admin || !addr) return false;
  try {
    // `as never`: email_suppressions postdates the generated Database types.
    const { data } = await admin
      .from('email_suppressions' as never)
      .select('address')
      .eq('address', addr)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

/** Full branding + gating row for one gym. */
export async function getEmailGym(admin: Admin, gymId: string): Promise<EmailGym | null> {
  const { data } = await admin.from('gyms').select(GYM_EMAIL_COLUMNS).eq('id', gymId).maybeSingle();
  return (data as EmailGym | null) ?? null;
}

/** One person's contact details + their email opt-out. */
export async function getContact(admin: Admin, profileId: string): Promise<EmailContact | null> {
  const { data } = await admin
    .from('profiles')
    .select('id, email, full_name, phone, notification_email')
    .eq('id', profileId)
    .maybeSingle();
  if (!data) return null;
  const row = data as { id: string; email: string | null; full_name: string | null; phone: string | null; notification_email: boolean | null };
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    wantsEmail: row.notification_email !== false,
  };
}

/** Contacts for many profiles in one round-trip — used by class-cancellation and
 *  reminder fan-outs, which would otherwise issue a query per member. */
export async function getContacts(admin: Admin, profileIds: string[]): Promise<EmailContact[]> {
  const ids = [...new Set(profileIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const { data } = await admin
    .from('profiles')
    .select('id, email, full_name, phone, notification_email')
    .in('id', ids);
  return ((data ?? []) as Array<{ id: string; email: string | null; full_name: string | null; phone: string | null; notification_email: boolean | null }>)
    .map((r) => ({ id: r.id, email: r.email, fullName: r.full_name, phone: r.phone, wantsEmail: r.notification_email !== false }));
}

/**
 * Email addresses of a gym's active owners.
 *
 * Extracted verbatim from lib/payout-alerts.ts so the "who owns this gym"
 * question has one answer. Owners are the billing and security contact for
 * everything GymFlow sends a gym: platform receipts, trial expiry, payout
 * changes, freeze requests.
 */
export async function getGymOwnerEmails(admin: Admin, gymId: string): Promise<string[]> {
  const { data: links } = await admin
    .from('gym_staff_links')
    .select('user_id')
    .eq('gym_id', gymId)
    .eq('role', 'gym_owner')
    .eq('is_active', true);
  const ownerIds = [...new Set(((links ?? []) as { user_id: string | null }[])
    .map((l) => l.user_id).filter(Boolean) as string[])];
  if (ownerIds.length === 0) return [];
  const { data: profiles } = await admin.from('profiles').select('id, email').in('id', ownerIds);
  return [...new Set(((profiles ?? []) as { id: string; email: string | null }[])
    .map((p) => p.email).filter(Boolean) as string[])];
}

/** Owners plus managers — for operational mail a manager should also see
 *  (freeze requests, payout state) without being a billing contact. */
export async function getGymStaffEmails(admin: Admin, gymId: string, roles: UserRole[] = ['gym_owner', 'manager']): Promise<string[]> {
  const { data: links } = await admin
    .from('gym_staff_links')
    .select('user_id')
    .eq('gym_id', gymId)
    .in('role', roles)
    .eq('is_active', true);
  const ids = [...new Set(((links ?? []) as { user_id: string | null }[])
    .map((l) => l.user_id).filter(Boolean) as string[])];
  if (ids.length === 0) return [];
  const { data: profiles } = await admin.from('profiles').select('id, email').in('id', ids);
  return [...new Set(((profiles ?? []) as { id: string; email: string | null }[])
    .map((p) => p.email).filter(Boolean) as string[])];
}
