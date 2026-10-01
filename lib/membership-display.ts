export type MembershipDisplayState =
  | 'active'
  | 'scheduled'
  | 'expired'
  | 'frozen'
  | 'freeze_pending';

type MembershipDisplayInput = {
  status: string | null | undefined;
  startDate: string | null | undefined;
  daysRemaining: number;
  today: string;
};

/**
 * The member-facing state for a subscription row.
 *
 * Database status alone is not enough: a paid subscription may be created
 * before its access period starts. Access and the UI both become active on the
 * WAT start date, while freeze states continue to take precedence.
 */
export function membershipDisplayState({
  status,
  startDate,
  daysRemaining,
  today,
}: MembershipDisplayInput): MembershipDisplayState {
  if (status === 'paused') return 'frozen';
  if (status === 'pause_requested') return 'freeze_pending';

  const accessStatus = status === 'active' || status === 'past_due';
  if (accessStatus && startDate && startDate > today) return 'scheduled';
  if (accessStatus && startDate && startDate <= today && daysRemaining > 0) return 'active';
  return 'expired';
}
