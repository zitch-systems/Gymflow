import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canonicalWaId, waIdToLocal, phoneVariants } from '@/lib/whatsapp/phone';
import type { Database } from '@/lib/database.types';

type Admin = SupabaseClient<Database>;

export type WhatsAppContact = {
  id: string;
  wa_id: string;
  profile_id: string | null;
  active_gym_id: string | null;
  display_name: string | null;
  state: Record<string, unknown>;
  opted_in: boolean;
  blocked: boolean;
  last_inbound_at: string | null;
  /** Set only after a Flow sign-in/sign-up (see linkContact). Null for a
   *  contact that was merely auto-linked by phone-number match — that proves
   *  read access to membership state, not the right to spend on it. */
  verified_at: string | null;
};

const CONTACT_COLS =
  'id, wa_id, profile_id, active_gym_id, display_name, state, opted_in, blocked, last_inbound_at, verified_at';

/**
 * Find or create the contact row for an inbound WhatsApp message.
 *
 * On first contact we try to recognise the number: a member who already gave
 * their phone to the gym gets linked to their profile immediately, so they can
 * ask about their membership without signing in again. That is a deliberate
 * trust decision — possession of the WhatsApp number is treated as proof of
 * that number, which is the same assumption every OTP-by-SMS login makes, and
 * the number reached us through Meta rather than being typed by the sender.
 *
 * It grants read access to membership state only. Anything that spends money or
 * changes credentials still goes through the Flow with a password.
 */
export async function upsertContact(
  admin: Admin,
  params: { waId: string; displayName?: string | null; inbound?: boolean },
): Promise<WhatsAppContact | null> {
  const waId = canonicalWaId(params.waId);
  if (!waId) return null;

  const { data: existing } = await admin
    .from('whatsapp_contacts').select(CONTACT_COLS).eq('wa_id', waId).maybeSingle();

  const now = new Date().toISOString();

  if (existing) {
    const contact = existing as WhatsAppContact;
    const patch: Record<string, unknown> = { updated_at: now };
    if (params.inbound) patch.last_inbound_at = now;
    // Meta's pushed display name changes when the user edits their WhatsApp
    // profile; keep ours current but never overwrite with a blank.
    if (params.displayName && params.displayName !== contact.display_name) {
      patch.display_name = params.displayName;
    }
    // An unlinked contact gets another chance to be recognised on every
    // message — the gym may have added their number since they last wrote.
    if (!contact.profile_id) {
      const found = await findProfileByWaId(admin, waId);
      if (found) {
        patch.profile_id = found.profileId;
        if (!contact.active_gym_id && found.gymId) patch.active_gym_id = found.gymId;
      }
    }
    const { data: updated } = await admin
      .from('whatsapp_contacts').update(patch as never).eq('id', contact.id).select(CONTACT_COLS).maybeSingle();
    return (updated as WhatsAppContact | null) ?? contact;
  }

  const found = await findProfileByWaId(admin, waId);
  const { data: created, error } = await admin
    .from('whatsapp_contacts')
    .insert({
      wa_id: waId,
      display_name: params.displayName ?? null,
      profile_id: found?.profileId ?? null,
      active_gym_id: found?.gymId ?? null,
      last_inbound_at: params.inbound ? now : null,
    })
    .select(CONTACT_COLS)
    .maybeSingle();

  // A concurrent webhook delivery may have inserted the same wa_id between our
  // SELECT and INSERT; the unique index turns that into 23505 and we simply
  // read the winner's row.
  if (error?.code === '23505') {
    const { data: raced } = await admin
      .from('whatsapp_contacts').select(CONTACT_COLS).eq('wa_id', waId).maybeSingle();
    return (raced as WhatsAppContact | null) ?? null;
  }
  return (created as WhatsAppContact | null) ?? null;
}

/**
 * Match a wa_id to an existing member profile by phone number, and to the gym
 * they are actively linked to. Ambiguity (a number on more than one profile, or
 * a member at more than one gym) resolves to no gym rather than a guess — the
 * conversation asks them which gym instead of picking one for them.
 */
export async function findProfileByWaId(
  admin: Admin,
  waId: string,
): Promise<{ profileId: string; gymId: string | null } | null> {
  const local = waIdToLocal(waId);
  if (!local) return null;

  const { data: profiles } = await admin
    .from('profiles').select('id').in('phone', phoneVariants(local)).limit(2);
  const rows = (profiles as { id: string }[] | null) ?? [];
  // Two profiles sharing a phone number is a data problem, not something to
  // resolve by coin flip — linking the wrong one would expose one member's
  // membership to another.
  if (rows.length !== 1) return null;

  const profileId = rows[0].id;
  const gymIds = await activeGymIds(admin, profileId);
  return { profileId, gymId: gymIds.length === 1 ? gymIds[0] : null };
}

/** The gyms this member is actively linked to. */
export async function activeGymIds(admin: Admin, profileId: string): Promise<string[]> {
  const { data } = await admin
    .from('gym_member_links').select('gym_id')
    .or(`member_id.eq.${profileId},user_id.eq.${profileId}`)
    .eq('is_active', true);
  const ids = ((data as { gym_id: string | null }[] | null) ?? [])
    .map((r) => r.gym_id)
    .filter((id): id is string => Boolean(id));
  return Array.from(new Set(ids));
}

/** Attach a contact to a profile + gym after a successful Flow sign-in/up. */
/**
 * Bind a contact to the account it just proved itself as, through the Flow.
 * This is the ONLY writer of verified_at — everything that gates a
 * money-moving action on being verified relies on that being true.
 */
export async function linkContact(
  admin: Admin,
  contactId: string,
  params: { profileId: string; gymId: string },
): Promise<void> {
  const now = new Date().toISOString();
  await admin
    .from('whatsapp_contacts')
    .update({
      profile_id: params.profileId,
      active_gym_id: params.gymId,
      verified_at: now,
      updated_at: now,
    })
    .eq('id', contactId);
}

/**
 * The inverse of linkContact: forget which account this number belongs to.
 *
 * Clears verified_at with it, so a signed-out contact cannot spend money on the
 * membership it used to be attached to — the money-moving gate reads that
 * column, and leaving it set while the profile link is gone would be a hole.
 * active_gym_id is deliberately kept: the person is still standing in the same
 * gym, and asking them for the code again to sign back in would be pointless.
 */
export async function unlinkContact(admin: Admin, contactId: string): Promise<void> {
  await admin
    .from('whatsapp_contacts')
    .update({ profile_id: null, verified_at: null, updated_at: new Date().toISOString() })
    .eq('id', contactId);
}

export async function setActiveGym(admin: Admin, contactId: string, gymId: string): Promise<void> {
  await admin
    .from('whatsapp_contacts')
    .update({ active_gym_id: gymId, updated_at: new Date().toISOString() })
    .eq('id', contactId);
}

/**
 * Merge a patch into the contact's conversation state. Read-modify-write on a
 * small jsonb blob: two messages from the same person are processed in webhook
 * order, so the lost-update window is not reachable in practice.
 */
export async function patchState(
  admin: Admin,
  contact: WhatsAppContact,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const next = { ...(contact.state ?? {}), ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
  await admin
    .from('whatsapp_contacts')
    .update({ state: next as never, updated_at: new Date().toISOString() })
    .eq('id', contact.id);
  return next;
}

export async function clearState(admin: Admin, contactId: string): Promise<void> {
  await admin
    .from('whatsapp_contacts')
    .update({ state: {}, updated_at: new Date().toISOString() })
    .eq('id', contactId);
}

export async function setOptIn(admin: Admin, contactId: string, optedIn: boolean): Promise<void> {
  await admin
    .from('whatsapp_contacts')
    .update({
      opted_in: optedIn,
      opted_out_at: optedIn ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId);
}

export async function contactByWaId(admin: Admin, waId: string): Promise<WhatsAppContact | null> {
  const canonical = canonicalWaId(waId);
  if (!canonical) return null;
  const { data } = await admin
    .from('whatsapp_contacts').select(CONTACT_COLS).eq('wa_id', canonical).maybeSingle();
  return (data as WhatsAppContact | null) ?? null;
}

/**
 * The contact row for a member, used by the reminder and payment-confirmation
 * paths to find where to send. Prefers an explicitly linked row, then falls
 * back to matching the profile's phone number — a member who has never messaged
 * us still has a reachable WhatsApp number on file, and a renewal reminder is
 * exactly the message worth sending to it.
 */
export async function contactForProfile(
  admin: Admin,
  profileId: string,
  phone: string | null,
): Promise<WhatsAppContact | null> {
  const { data } = await admin
    .from('whatsapp_contacts').select(CONTACT_COLS).eq('profile_id', profileId).maybeSingle();
  if (data) return data as WhatsAppContact;
  const waId = canonicalWaId(phone ?? '');
  return waId ? contactByWaId(admin, waId) : null;
}
