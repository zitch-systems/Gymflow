import { describe, expect, it, vi } from 'vitest';
import { pendingAttendance, saveAttendance } from '@/app/(coach)/coach/attendance/attendance-requests';

const sessions = [
  { id: 'scheduled', name: 'Ada', status: 'scheduled' },
  { id: 'completed', name: 'Ben', status: 'completed' },
  { id: 'no_show', name: 'Chi', status: 'no_show' },
  { id: 'cancelled', name: 'Dee', status: 'cancelled' },
];

describe('coach attendance requests', () => {
  it('bulk completion includes only scheduled sessions', () => {
    expect(pendingAttendance(sessions).map((s) => s.id)).toEqual(['scheduled']);
  });

  it('does not overwrite cancelled or unknown sessions', async () => {
    const mark = vi.fn().mockResolvedValue({ ok: true, error: null });
    const result = await saveAttendance([sessions[3], { id: 'old', name: 'Old', status: 'unknown' }], 'completed', mark);
    expect(mark).not.toHaveBeenCalled();
    expect(result).toEqual({ saved: 0, errors: [] });
  });

  it('reports a rejected write and continues with later sessions', async () => {
    const mark = vi.fn().mockResolvedValueOnce({ ok: false, error: 'Session no longer available.' }).mockResolvedValueOnce({ ok: true, error: null });
    const result = await saveAttendance(sessions.slice(0, 2), 'completed', mark);
    expect(result).toEqual({ saved: 1, errors: ['Ada: Session no longer available.'] });
    expect(mark).toHaveBeenCalledTimes(2);
  });

  it('turns a transport error into retry feedback without claiming success', async () => {
    const mark = vi.fn().mockRejectedValue(new Error('Network failed'));
    const result = await saveAttendance([sessions[0]], 'no_show', mark);
    expect(result.saved).toBe(0);
    expect(result.errors).toEqual(['Ada: Could not connect. Please retry.']);
  });
});
