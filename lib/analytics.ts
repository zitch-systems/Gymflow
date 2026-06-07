// Pure aggregation helpers for the admin analytics v2 surface (churn,
// at-risk, cohort retention, LTV). Kept side-effect-free and injected with
// `nowMs` so they unit-test deterministically; the page does the Supabase
// reads and hands raw rows in.

const DAY_MS = 86_400_000;

export type MembershipLite = {
  member_id: string | null;
  status: string | null;
  end_date: string | null;
  plan_id: string | null;
};

export type PaymentLite = {
  member_id?: string | null;
  amount: number | null;
  plan_id?: string | null;
};

export type JoinLite = { user_id: string | null; joined_at: string | null };

/** Reduce many membership rows to one row per member: their furthest
 *  end_date and the plan tied to it. A member can have stacked/renewed
 *  rows; the latest end_date is what determines current standing. */
function latestPerMember(memberships: MembershipLite[]): Map<string, { endMs: number; planId: string | null }> {
  const out = new Map<string, { endMs: number; planId: string | null }>();
  for (const m of memberships) {
    if (!m.member_id || !m.end_date) continue;
    const endMs = new Date(m.end_date).getTime();
    if (!Number.isFinite(endMs)) continue;
    const prev = out.get(m.member_id);
    if (!prev || endMs > prev.endMs) out.set(m.member_id, { endMs, planId: m.plan_id });
  }
  return out;
}

/**
 * Active vs recently-churned members and a 30-day churn rate.
 * - active: latest end_date is today or later
 * - churnedInWindow: latest end_date fell within the last `windowDays`
 *   (they were active at the window start and didn't renew)
 * - churnRatePct: churnedInWindow / (active + churnedInWindow), i.e. of the
 *   members who were active at the start of the window, the share that lapsed.
 */
export function computeChurn(
  memberships: MembershipLite[],
  nowMs: number,
  windowDays = 30,
): { active: number; churnedInWindow: number; churnRatePct: number } {
  const latest = latestPerMember(memberships);
  const windowStart = nowMs - windowDays * DAY_MS;
  let active = 0;
  let churnedInWindow = 0;
  for (const { endMs } of latest.values()) {
    if (endMs >= nowMs) active += 1;
    else if (endMs >= windowStart) churnedInWindow += 1;
  }
  const base = active + churnedInWindow;
  const churnRatePct = base === 0 ? 0 : Math.round((churnedInWindow / base) * 100);
  return { active, churnedInWindow, churnRatePct };
}

/**
 * Currently-active members who haven't checked in within `thresholdDays` —
 * the early-warning churn signal. `lastCheckInMsByMember` maps member_id to
 * their most recent check-in time (ms); absent = never checked in.
 */
export function computeAtRisk(
  memberships: MembershipLite[],
  lastCheckInMsByMember: Map<string, number>,
  nowMs: number,
  thresholdDays = 21,
): { atRisk: number; activeTotal: number } {
  const latest = latestPerMember(memberships);
  const cutoff = nowMs - thresholdDays * DAY_MS;
  let atRisk = 0;
  let activeTotal = 0;
  for (const [memberId, { endMs }] of latest) {
    if (endMs < nowMs) continue; // only active members can be "at risk"
    activeTotal += 1;
    const last = lastCheckInMsByMember.get(memberId);
    if (last == null || last < cutoff) atRisk += 1;
  }
  return { atRisk, activeTotal };
}

/**
 * Lifetime value: total successful revenue per distinct paying member,
 * overall and broken down by plan. Per-plan LTV = plan revenue / distinct
 * members who paid on that plan.
 */
export function computeLtv(
  payments: PaymentLite[],
  planNames: Map<string, string>,
): {
  overallLtv: number;
  payingMembers: number;
  totalRevenue: number;
  byPlan: Array<{ planId: string; planName: string; revenue: number; members: number; ltv: number }>;
} {
  let totalRevenue = 0;
  const allMembers = new Set<string>();
  const planRevenue = new Map<string, number>();
  const planMembers = new Map<string, Set<string>>();

  for (const p of payments) {
    const amt = Number(p.amount ?? 0);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    totalRevenue += amt;
    if (p.member_id) allMembers.add(p.member_id);
    if (p.plan_id) {
      planRevenue.set(p.plan_id, (planRevenue.get(p.plan_id) ?? 0) + amt);
      if (p.member_id) {
        const set = planMembers.get(p.plan_id) ?? new Set<string>();
        set.add(p.member_id);
        planMembers.set(p.plan_id, set);
      }
    }
  }

  const payingMembers = allMembers.size;
  const overallLtv = payingMembers === 0 ? 0 : Math.round(totalRevenue / payingMembers);

  const byPlan = [...planRevenue.entries()]
    .map(([planId, revenue]) => {
      const members = planMembers.get(planId)?.size ?? 0;
      return {
        planId,
        planName: planNames.get(planId) ?? 'Unknown plan',
        revenue,
        members,
        ltv: members === 0 ? 0 : Math.round(revenue / members),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  return { overallLtv, payingMembers, totalRevenue, byPlan };
}

/**
 * Cohort retention by join month. For the last `monthsBack` months, count
 * members who joined that month and how many are still active now.
 * `activeMemberIds` is the set of currently-active member_ids.
 */
export function computeCohorts(
  joins: JoinLite[],
  activeMemberIds: Set<string>,
  nowMs: number,
  monthsBack = 6,
): Array<{ key: string; label: string; joined: number; retained: number; retentionPct: number }> {
  const now = new Date(nowMs);
  const keys: string[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const joined = new Map<string, number>(keys.map((k) => [k, 0]));
  const retained = new Map<string, number>(keys.map((k) => [k, 0]));

  for (const j of joins) {
    if (!j.user_id || !j.joined_at) continue;
    const d = new Date(j.joined_at);
    if (!Number.isFinite(d.getTime())) continue;
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!joined.has(k)) continue;
    joined.set(k, joined.get(k)! + 1);
    if (activeMemberIds.has(j.user_id)) retained.set(k, retained.get(k)! + 1);
  }

  return keys.map((k) => {
    const [y, m] = k.split('-');
    const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-NG', { month: 'short', year: '2-digit' });
    const j = joined.get(k)!;
    const r = retained.get(k)!;
    return { key: k, label, joined: j, retained: r, retentionPct: j === 0 ? 0 : Math.round((r / j) * 100) };
  });
}
