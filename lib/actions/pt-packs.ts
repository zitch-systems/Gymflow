'use server';

import { createAdminClient } from '@/lib/supabase/admin';

// The admin PT-Packs surface (create / activate / grant) was cut with the
// rest of the admin routes that aren't in the revamp prototype. This one
// helper stays because the coach booking flow still depends on it:
// coach.scheduleSession decrements a member's PT credit after a session is
// booked. It references nothing from the cut admin route.

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
