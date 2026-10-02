import { describe, expect, it } from 'vitest';
import { membershipDisplayState } from '@/lib/membership-display';

const today = '2026-10-01';

describe('membershipDisplayState', () => {
  it.each(['active', 'past_due'])('activates %s access on its WAT start date', (status) => {
    expect(membershipDisplayState({ status, startDate: today, daysRemaining: 1, today })).toBe('active');
  });

  it('keeps a paid future period scheduled until its WAT start date', () => {
    expect(membershipDisplayState({
      status: 'active', startDate: '2026-10-02', daysRemaining: 31, today,
    })).toBe('scheduled');
  });

  it('does not present elapsed or non-access rows as active', () => {
    expect(membershipDisplayState({ status: 'active', startDate: '2026-09-01', daysRemaining: 0, today })).toBe('expired');
    expect(membershipDisplayState({ status: 'cancelled', startDate: today, daysRemaining: 31, today })).toBe('expired');
    expect(membershipDisplayState({ status: 'active', startDate: null, daysRemaining: 31, today })).toBe('expired');
  });

  it('preserves freeze states even when their period starts in the future', () => {
    expect(membershipDisplayState({ status: 'paused', startDate: '2026-10-02', daysRemaining: 31, today })).toBe('frozen');
    expect(membershipDisplayState({ status: 'pause_requested', startDate: '2026-10-02', daysRemaining: 31, today })).toBe('freeze_pending');
  });
});
