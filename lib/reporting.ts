import type { MembershipDisplayState } from '@/lib/membership-display';
import { rateLabel, type CommissionBreakdown, type GymCommission } from '@/lib/commission-breakdown';

type JsonObject = Record<string, unknown>;

const object = (value: unknown, label: string): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid payload`);
  }
  return value as JsonObject;
};

const number = (value: unknown, label: string): number => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`${label} returned an invalid number`);
  return parsed;
};

const nullableString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const array = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${label} returned an invalid list`);
  return value;
};

export type DailyTotal = { day: string; total: number };
export type PlanTotal = { planId: string | null; name: string; total: number };

export type GymReportingSummary = {
  roster: number;
  activeAccess: number;
  expiring: number;
  lapsed: number;
  scheduled: number;
  frozen: number;
  freezePending: number;
  fresh: number;
  churned30d: number;
  revenue30d: number;
  revenueDaily: DailyTotal[];
  checkinsToday: number;
  checkins7d: number;
  checkinDaily: DailyTotal[];
  planMix: PlanTotal[];
};

const dailyTotals = (value: unknown, label: string): DailyTotal[] =>
  array(value, label).map((item, index) => {
    const row = object(item, `${label}[${index}]`);
    if (typeof row.day !== 'string') throw new Error(`${label}[${index}] returned an invalid day`);
    return { day: row.day, total: number(row.total, `${label}[${index}].total`) };
  });

export function parseGymReportingSummary(value: unknown): GymReportingSummary {
  const row = object(value, 'gym_reporting_summary');
  return {
    roster: number(row.roster, 'gym_reporting_summary.roster'),
    activeAccess: number(row.activeAccess, 'gym_reporting_summary.activeAccess'),
    expiring: number(row.expiring, 'gym_reporting_summary.expiring'),
    lapsed: number(row.lapsed, 'gym_reporting_summary.lapsed'),
    scheduled: number(row.scheduled, 'gym_reporting_summary.scheduled'),
    frozen: number(row.frozen, 'gym_reporting_summary.frozen'),
    freezePending: number(row.freezePending, 'gym_reporting_summary.freezePending'),
    fresh: number(row.fresh, 'gym_reporting_summary.fresh'),
    churned30d: number(row.churned30d, 'gym_reporting_summary.churned30d'),
    revenue30d: number(row.revenue30d, 'gym_reporting_summary.revenue30d'),
    revenueDaily: dailyTotals(row.revenueDaily, 'gym_reporting_summary.revenueDaily'),
    checkinsToday: number(row.checkinsToday, 'gym_reporting_summary.checkinsToday'),
    checkins7d: number(row.checkins7d, 'gym_reporting_summary.checkins7d'),
    checkinDaily: dailyTotals(row.checkinDaily, 'gym_reporting_summary.checkinDaily'),
    planMix: array(row.planMix, 'gym_reporting_summary.planMix').map((item, index) => {
      const plan = object(item, `gym_reporting_summary.planMix[${index}]`);
      if (typeof plan.name !== 'string') throw new Error(`gym_reporting_summary.planMix[${index}] returned an invalid name`);
      return {
        planId: nullableString(plan.planId),
        name: plan.name,
        total: number(plan.total, `gym_reporting_summary.planMix[${index}].total`),
      };
    }),
  };
}

export type RosterRow = {
  memberId: string;
  joinedAt: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  subscriptionId: string | null;
  planId: string | null;
  subscriptionStatus: string | null;
  startDate: string | null;
  endDate: string | null;
  planName: string | null;
  planPrice: number | null;
  displayState: MembershipDisplayState;
};

export type RosterPage = { total: number; rows: RosterRow[] };

const DISPLAY_STATES = new Set<MembershipDisplayState>([
  'active', 'scheduled', 'expired', 'frozen', 'freeze_pending',
]);

export function parseRosterPage(value: unknown): RosterPage {
  const result = object(value, 'gym_member_roster');
  return {
    total: number(result.total, 'gym_member_roster.total'),
    rows: array(result.rows, 'gym_member_roster.rows').map((item, index) => {
      const row = object(item, `gym_member_roster.rows[${index}]`);
      if (typeof row.memberId !== 'string') throw new Error(`gym_member_roster.rows[${index}] returned an invalid member id`);
      if (typeof row.displayState !== 'string' || !DISPLAY_STATES.has(row.displayState as MembershipDisplayState)) {
        throw new Error(`gym_member_roster.rows[${index}] returned an invalid display state`);
      }
      return {
        memberId: row.memberId,
        joinedAt: nullableString(row.joinedAt),
        fullName: nullableString(row.fullName),
        firstName: nullableString(row.firstName),
        lastName: nullableString(row.lastName),
        email: nullableString(row.email),
        subscriptionId: nullableString(row.subscriptionId),
        planId: nullableString(row.planId),
        subscriptionStatus: nullableString(row.subscriptionStatus),
        startDate: nullableString(row.startDate),
        endDate: nullableString(row.endDate),
        planName: nullableString(row.planName),
        planPrice: row.planPrice === null || row.planPrice === undefined
          ? null
          : number(row.planPrice, `gym_member_roster.rows[${index}].planPrice`),
        displayState: row.displayState as MembershipDisplayState,
      };
    }),
  };
}

export type ActivePlanGroup = { tier: string | null; cycle: string | null; total: number };
export type PlatformGymSummary = {
  gyms: number;
  activeGyms: number;
  trialGyms: number;
  pastDueGyms: number;
  members: number;
  activeSubscriptions: number;
  activePlanMix: ActivePlanGroup[];
};

export function parsePlatformGymSummary(value: unknown): PlatformGymSummary {
  const row = object(value, 'platform_gym_summary');
  return {
    gyms: number(row.gyms, 'platform_gym_summary.gyms'),
    activeGyms: number(row.activeGyms, 'platform_gym_summary.activeGyms'),
    trialGyms: number(row.trialGyms, 'platform_gym_summary.trialGyms'),
    pastDueGyms: number(row.pastDueGyms, 'platform_gym_summary.pastDueGyms'),
    members: number(row.members, 'platform_gym_summary.members'),
    activeSubscriptions: number(row.activeSubscriptions, 'platform_gym_summary.activeSubscriptions'),
    activePlanMix: array(row.activePlanMix, 'platform_gym_summary.activePlanMix').map((item, index) => {
      const group = object(item, `platform_gym_summary.activePlanMix[${index}]`);
      return {
        tier: nullableString(group.tier),
        cycle: nullableString(group.cycle),
        total: number(group.total, `platform_gym_summary.activePlanMix[${index}].total`),
      };
    }),
  };
}

export function parsePlatformCommissionSummary(value: unknown): CommissionBreakdown {
  const result = object(value, 'platform_commission_summary');
  const rows: GymCommission[] = array(result.rows, 'platform_commission_summary.rows').map((item, index) => {
    const row = object(item, `platform_commission_summary.rows[${index}]`);
    if (typeof row.gym_id !== 'string') throw new Error(`platform_commission_summary.rows[${index}] returned an invalid gym id`);
    const arrangement = {
      commission_mode: nullableString(row.commission_mode),
      commission_pct: row.commission_pct === null ? null : number(row.commission_pct, `platform_commission_summary.rows[${index}].commission_pct`),
      commission_fixed_amount: row.commission_fixed_amount === null ? null : number(row.commission_fixed_amount, `platform_commission_summary.rows[${index}].commission_fixed_amount`),
    };
    return {
      gymId: row.gym_id,
      name: nullableString(row.gym_name)?.trim() || 'Unnamed gym',
      rateLabel: rateLabel(arrangement),
      payments: number(row.commission_payments, `platform_commission_summary.rows[${index}].commission_payments`),
      commission: number(row.commission_total, `platform_commission_summary.rows[${index}].commission_total`),
      fromPercentage: number(row.percentage_total, `platform_commission_summary.rows[${index}].percentage_total`),
      fromFlat: number(row.flat_total, `platform_commission_summary.rows[${index}].flat_total`),
      unclassified: number(row.unclassified_total, `platform_commission_summary.rows[${index}].unclassified_total`),
      unrecordedPayments: number(row.unrecorded_payments, `platform_commission_summary.rows[${index}].unrecorded_payments`),
      heldPayments: number(row.held_payments, `platform_commission_summary.rows[${index}].held_payments`),
      held: number(row.held_total, `platform_commission_summary.rows[${index}].held_total`),
    };
  });
  return {
    total: number(result.total, 'platform_commission_summary.total'),
    fromPercentage: number(result.fromPercentage, 'platform_commission_summary.fromPercentage'),
    fromFlat: number(result.fromFlat, 'platform_commission_summary.fromFlat'),
    unclassified: number(result.unclassified, 'platform_commission_summary.unclassified'),
    payments: number(result.payments, 'platform_commission_summary.payments'),
    earningGyms: number(result.earningGyms, 'platform_commission_summary.earningGyms'),
    held: number(result.held, 'platform_commission_summary.held'),
    heldPayments: number(result.heldPayments, 'platform_commission_summary.heldPayments'),
    unrecordedPayments: number(result.unrecordedPayments, 'platform_commission_summary.unrecordedPayments'),
    rows,
    hiddenGyms: number(result.hiddenGyms, 'platform_commission_summary.hiddenGyms'),
    hiddenCommission: number(result.hiddenCommission, 'platform_commission_summary.hiddenCommission'),
  };
}

export type ReportingRpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};
