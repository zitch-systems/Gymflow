import { describe, it, expect } from 'vitest';
import { computeChurn, computeAtRisk, computeLtv, computeCohorts } from '@/lib/analytics';

const DAY = 86_400_000;
const now = Date.parse('2026-05-30T12:00:00.000Z');
const daysAgo = (n: number) => new Date(now - n * DAY).toISOString();
const daysAhead = (n: number) => new Date(now + n * DAY).toISOString();

describe('computeChurn', () => {
  it('counts active (end in future) vs churned-in-window (end in last 30d)', () => {
    const r = computeChurn(
      [
        { member_id: 'a', status: 'active', end_date: daysAhead(10), plan_id: 'p1' },
        { member_id: 'b', status: 'active', end_date: daysAhead(5), plan_id: 'p1' },
        { member_id: 'c', status: 'expired', end_date: daysAgo(10), plan_id: 'p1' }, // churned in window
        { member_id: 'd', status: 'expired', end_date: daysAgo(200), plan_id: 'p1' }, // long gone, not in window
      ],
      now,
    );
    expect(r.active).toBe(2);
    expect(r.churnedInWindow).toBe(1);
    expect(r.churnRatePct).toBe(Math.round((1 / 3) * 100)); // 33
  });

  it('dedups multiple memberships per member to the furthest end_date', () => {
    const r = computeChurn(
      [
        { member_id: 'a', status: 'expired', end_date: daysAgo(40), plan_id: 'p1' },
        { member_id: 'a', status: 'active', end_date: daysAhead(20), plan_id: 'p2' }, // renewal — wins
      ],
      now,
    );
    expect(r.active).toBe(1);
    expect(r.churnedInWindow).toBe(0);
  });

  it('returns 0 churn rate with no members', () => {
    expect(computeChurn([], now).churnRatePct).toBe(0);
  });
});

describe('computeAtRisk', () => {
  it('flags active members with no recent check-in', () => {
    const memberships = [
      { member_id: 'a', status: 'active', end_date: daysAhead(10), plan_id: 'p1' },
      { member_id: 'b', status: 'active', end_date: daysAhead(10), plan_id: 'p1' },
      { member_id: 'c', status: 'expired', end_date: daysAgo(5), plan_id: 'p1' }, // not active, ignored
    ];
    const lastCheckIn = new Map<string, number>([
      ['a', now - 3 * DAY],  // recent — fine
      ['b', now - 40 * DAY], // stale — at risk
      // c never checked in but isn't active
    ]);
    const r = computeAtRisk(memberships, lastCheckIn, now, 21);
    expect(r.activeTotal).toBe(2);
    expect(r.atRisk).toBe(1);
  });

  it('treats never-checked-in active members as at risk', () => {
    const r = computeAtRisk(
      [{ member_id: 'a', status: 'active', end_date: daysAhead(10), plan_id: 'p1' }],
      new Map(),
      now,
      21,
    );
    expect(r.atRisk).toBe(1);
  });
});

describe('computeLtv', () => {
  it('computes overall and per-plan LTV from distinct paying members', () => {
    const names = new Map([['p1', 'Monthly'], ['p2', 'Annual']]);
    const r = computeLtv(
      [
        { member_id: 'a', amount: 10000, plan_id: 'p1' },
        { member_id: 'a', amount: 10000, plan_id: 'p1' }, // same member pays twice
        { member_id: 'b', amount: 50000, plan_id: 'p2' },
      ],
      names,
    );
    expect(r.totalRevenue).toBe(70000);
    expect(r.payingMembers).toBe(2);
    expect(r.overallLtv).toBe(35000);
    const p1 = r.byPlan.find((x) => x.planId === 'p1')!;
    expect(p1.revenue).toBe(20000);
    expect(p1.members).toBe(1);
    expect(p1.ltv).toBe(20000);
    // sorted by revenue desc → Annual first
    expect(r.byPlan[0].planId).toBe('p2');
  });

  it('ignores zero/negative/NaN amounts', () => {
    const r = computeLtv(
      [
        { member_id: 'a', amount: 0, plan_id: 'p1' },
        { member_id: 'a', amount: -500, plan_id: 'p1' },
        { member_id: 'a', amount: 1000, plan_id: 'p1' },
      ],
      new Map([['p1', 'Monthly']]),
    );
    expect(r.totalRevenue).toBe(1000);
    expect(r.payingMembers).toBe(1);
  });
});

describe('computeCohorts', () => {
  it('buckets joins by month and counts retained (still-active) members', () => {
    const active = new Set(['a', 'c']);
    const rows = computeCohorts(
      [
        { user_id: 'a', joined_at: '2026-05-02T00:00:00Z' }, // this month, active
        { user_id: 'b', joined_at: '2026-05-20T00:00:00Z' }, // this month, churned
        { user_id: 'c', joined_at: '2026-04-10T00:00:00Z' }, // last month, active
      ],
      active,
      now,
      6,
    );
    const may = rows.find((r) => r.key === '2026-05')!;
    expect(may.joined).toBe(2);
    expect(may.retained).toBe(1);
    expect(may.retentionPct).toBe(50);
    const apr = rows.find((r) => r.key === '2026-04')!;
    expect(apr.joined).toBe(1);
    expect(apr.retained).toBe(1);
    expect(apr.retentionPct).toBe(100);
  });

  it('returns the requested number of month buckets', () => {
    expect(computeCohorts([], new Set(), now, 6)).toHaveLength(6);
  });
});
