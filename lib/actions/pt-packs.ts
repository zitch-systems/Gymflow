'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth/gym';
import { getSessionUser } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';

type Result = { ok: boolean; error?: string };

/**
 * Create a new PT pack offering for this gym. Manager/owner gated; pack is
 * specific to one coach + one session-count + one price.
 */
export async function createPtPack(slug: string, formData: FormData): Promise<Result> {
  const { gym } = await requireStaff(slug);
  const actor = await getSessionUser();
  const name = String(formData.get('name') ?? '').trim();
  const instructor_id = String(formData.get('instructor_id') ?? '').trim();
  const session_count = Math.floor(Number(formData.get('session_count') ?? 0));
  const price = Number(formData.get('price') ?? 0);

  if (!name) return { ok: false, error: 'Name required' };
  if (!instructor_id) return { ok: false, error: 'Pick a coach' };
  if (!Number.isFinite(session_count) || session_count <= 0 || session_count > 100) {
    return { ok: false, error: 'Session count must be 1–100' };
  }
  if (!Number.isFinite(price) || price < 0) return { ok: false, error: 'Price must be ≥ 0' };

  const admin = createAdminClient();
  // pt_packs not in generated types yet.
  const { data, error } = await admin
    .from('pt_packs' as never)
    .insert({ gym_id: gym.id, instructor_id, name, session_count, price, currency: 'NGN' } as never)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };

  await audit({
    gymId: gym.id,
    actorId: actor?.id ?? null,
    action: 'admin.pt_pack_created',
    table: 'pt_packs',
    recordId: (data as { id: string } | null)?.id ?? null,
    after: { name, instructor_id, session_count, price },
  });
  revalidatePath(`/gym/${slug}/admin/pt-packs`);
  return { ok: true };
}

export async function setPtPackActive(slug: string, packId: string, isActive: boolean): Promise<Result> {
  const { gym } = await requireStaff(slug);
  const actor = await getSessionUser();
  const admin = createAdminClient();
  const { error } = await admin
    .from('pt_packs' as never)
    .update({ is_active: isActive, updated_at: new Date().toISOString() } as never)
    .eq('id', packId)
    .eq('gym_id', gym.id);
  if (error) return { ok: false, error: error.message };
  await audit({
    gymId: gym.id,
    actorId: actor?.id ?? null,
    action: isActive ? 'admin.pt_pack_activated' : 'admin.pt_pack_deactivated',
    table: 'pt_packs',
    recordId: packId,
  });
  revalidatePath(`/gym/${slug}/admin/pt-packs`);
  return { ok: true };
}

/**
 * Manually grant a pack to a member (admin paid in cash / comp / off-platform).
 * Inserts a pt_pack_credits row with sessions_used=0. The member then sees the
 * balance and the coach's scheduleSession will decrement it.
 */
export async function grantPtPackToMember(slug: string, formData: FormData): Promise<Result> {
  const { gym } = await requireStaff(slug);
  const actor = await getSessionUser();
  const member_id = String(formData.get('member_id') ?? '').trim();
  const pack_id = String(formData.get('pack_id') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim() || null;

  if (!member_id || !pack_id) return { ok: false, error: 'Member and pack required' };

  const admin = createAdminClient();
  // Look up the pack to copy its session_count + instructor — the credit row
  // captures these AT GRANT TIME so future edits to the pack offering don't
  // retroactively change a member's balance.
  const { data: packRaw } = await admin
    .from('pt_packs' as never)
    .select('instructor_id, session_count, name')
    .eq('id' as never, pack_id)
    .eq('gym_id' as never, gym.id)
    .eq('is_active' as never, true)
    .maybeSingle();
  const pack = packRaw as unknown as { instructor_id: string; session_count: number; name: string } | null;
  if (!pack) return { ok: false, error: 'Pack not found or inactive' };

  // Cross-gym IDOR guard: member must actually belong to this gym.
  const { data: link } = await admin
    .from('gym_member_links')
    .select('user_id')
    .eq('gym_id', gym.id)
    .eq('user_id', member_id)
    .maybeSingle();
  if (!link) return { ok: false, error: 'That member is not part of this gym' };

  const { error } = await admin.from('pt_pack_credits' as never).insert({
    gym_id: gym.id,
    member_id,
    instructor_id: pack.instructor_id,
    pack_id,
    sessions_total: pack.session_count,
    sessions_used: 0,
    source: 'admin_grant',
    notes,
  } as never);
  if (error) return { ok: false, error: error.message };

  await audit({
    gymId: gym.id,
    actorId: actor?.id ?? null,
    userId: member_id,
    action: 'admin.pt_pack_granted',
    table: 'pt_pack_credits',
    after: { pack_id, pack_name: pack.name, session_count: pack.session_count },
  });
  revalidatePath(`/gym/${slug}/admin/pt-packs`);
  revalidatePath(`/gym/${slug}/admin/members/${member_id}`);
  return { ok: true };
}

/**
 * Try to consume one PT credit for (member_id, instructor_id) at this gym.
 * Returns {consumed:true, creditId} on success, {consumed:false} when the
 * member has no balance (caller proceeds without billing). NEVER decrements
 * below zero — the CHECK constraint on sessions_used backs this up, but the
 * action prefers a successful no-balance read over a 23514 error.
 *
 * Called from coach.scheduleSession after the session row is inserted.
 */
export async function consumePtCredit(args: {
  gymId: string;
  memberId: string;
  instructorId: string;
}): Promise<{ consumed: boolean; creditId?: string; remaining?: number }> {
  const admin = createAdminClient();
  // Pick the oldest credit with balance — first-in-first-out is the fairest
  // default and matches how members think about "use up my package".
  const { data: rowsRaw } = await admin
    .from('pt_pack_credits' as never)
    .select('id, sessions_total, sessions_used')
    .eq('gym_id' as never, args.gymId)
    .eq('member_id' as never, args.memberId)
    .eq('instructor_id' as never, args.instructorId)
    .order('purchased_at' as never, { ascending: true });
  const rows = (rowsRaw ?? []) as unknown as Array<{ id: string; sessions_total: number; sessions_used: number }>;
  const candidate = rows.find((r) => r.sessions_used < r.sessions_total);
  if (!candidate) return { consumed: false };

  // Optimistic update: only increment if sessions_used hasn't already
  // advanced past our snapshot (concurrent booking guard).
  const { data: updatedRaw, error } = await admin
    .from('pt_pack_credits' as never)
    .update({ sessions_used: candidate.sessions_used + 1 } as never)
    .eq('id', candidate.id)
    .eq('sessions_used', candidate.sessions_used)
    .select('id, sessions_total, sessions_used')
    .maybeSingle();
  if (error) return { consumed: false };
  const updated = updatedRaw as unknown as { id: string; sessions_total: number; sessions_used: number } | null;
  if (!updated) {
    // Race lost: another scheduler beat us. Treat as no-credit-consumed so
    // the session still books — the operator can reconcile manually rather
    // than us silently double-deducting.
    return { consumed: false };
  }
  return { consumed: true, creditId: updated.id, remaining: updated.sessions_total - updated.sessions_used };
}
