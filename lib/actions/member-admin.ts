'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth/gym';
import { getSessionUser } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';

type Result = { ok: boolean; error?: string };

const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,29}$/;

/**
 * Add a CRM-style tag to a member (gym-scoped). Idempotent on
 * (gym_id, user_id, tag) — re-adding the same tag is a silent no-op.
 *
 * Tags are gym-scoped: a member at gym A tagged "VIP" is independent of the
 * same member at gym B. The UNIQUE constraint on (gym_id, user_id, tag) is
 * the dedupe; the action just guards input and audits the write.
 */
export async function addMemberTag(slug: string, memberId: string, tag: string): Promise<Result> {
  const { gym } = await requireStaff(slug);
  const actor = await getSessionUser();
  const t = tag.trim();
  if (!TAG_RE.test(t)) return { ok: false, error: 'Tag must be 1–30 chars, letters/digits/spaces/_-, no leading space' };

  const admin = createAdminClient();
  // member_tags isn't in the generated types yet (20260530_member_tags_and_notes.sql),
  // cast through never so the column lookup typechecks.
  const { error } = await admin
    .from('member_tags' as never)
    .upsert(
      { gym_id: gym.id, user_id: memberId, tag: t, created_by: actor?.id ?? null } as never,
      { onConflict: 'gym_id,user_id,tag' } as never,
    );
  if (error) return { ok: false, error: error.message };

  await audit({
    gymId: gym.id,
    actorId: actor?.id ?? null,
    userId: memberId,
    action: 'admin.member_tag_added',
    table: 'member_tags',
    recordId: memberId,
    after: { tag: t },
  });

  revalidatePath(`/gym/${slug}/admin/members/${memberId}`);
  return { ok: true };
}

export async function removeMemberTag(slug: string, memberId: string, tag: string): Promise<Result> {
  const { gym } = await requireStaff(slug);
  const actor = await getSessionUser();
  const t = tag.trim();
  if (!t) return { ok: false, error: 'Empty tag' };

  const admin = createAdminClient();
  const { error } = await admin
    .from('member_tags' as never)
    .delete()
    .eq('gym_id' as never, gym.id)
    .eq('user_id' as never, memberId)
    .eq('tag' as never, t);
  if (error) return { ok: false, error: error.message };

  await audit({
    gymId: gym.id,
    actorId: actor?.id ?? null,
    userId: memberId,
    action: 'admin.member_tag_removed',
    table: 'member_tags',
    recordId: memberId,
    before: { tag: t },
  });

  revalidatePath(`/gym/${slug}/admin/members/${memberId}`);
  return { ok: true };
}

/**
 * Replace the staff-only notes on a member's gym link. Gym-scoped (the
 * notes live on gym_member_links). Empty string clears them.
 */
export async function saveMemberStaffNotes(slug: string, memberId: string, notes: string): Promise<Result> {
  const { gym } = await requireStaff(slug);
  const actor = await getSessionUser();
  const trimmed = notes.trim();
  if (trimmed.length > 4000) return { ok: false, error: 'Notes must be 4000 characters or fewer' };
  const value = trimmed === '' ? null : trimmed;

  const admin = createAdminClient();
  const { data: before } = await admin
    .from('gym_member_links')
    .select('staff_notes' as never)
    .eq('gym_id', gym.id)
    .eq('user_id', memberId)
    .maybeSingle();
  const { error } = await admin
    .from('gym_member_links')
    .update({ staff_notes: value } as never)
    .eq('gym_id', gym.id)
    .eq('user_id', memberId);
  if (error) return { ok: false, error: error.message };

  await audit({
    gymId: gym.id,
    actorId: actor?.id ?? null,
    userId: memberId,
    action: 'admin.member_notes_updated',
    table: 'gym_member_links',
    recordId: memberId,
    before: (before as unknown as { staff_notes: string | null }) ?? null,
    after: { staff_notes: value },
  });

  revalidatePath(`/gym/${slug}/admin/members/${memberId}`);
  return { ok: true };
}
