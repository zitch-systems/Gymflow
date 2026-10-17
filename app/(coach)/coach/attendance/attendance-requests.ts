export type AttendanceSession = { id: string; name: string; status: string };
export type AttendanceStatus = 'completed' | 'no_show';
type MarkResult = { ok: boolean; error: string | null };

// Only scheduled sessions belong in a bulk completion. Cancelled, completed
// and no-show records must never be silently overwritten by "Mark all".
export function pendingAttendance(sessions: AttendanceSession[]): AttendanceSession[] {
  return sessions.filter((session) => session.status === 'scheduled');
}

export async function saveAttendance(
  sessions: AttendanceSession[],
  status: AttendanceStatus,
  mark: (id: string, status: AttendanceStatus) => Promise<MarkResult>,
): Promise<{ saved: number; errors: string[] }> {
  let saved = 0;
  const errors: string[] = [];
  for (const session of sessions) {
    if (!['scheduled', 'completed', 'no_show'].includes(session.status)) continue;
    try {
      const result = await mark(session.id, status);
      if (result.ok) saved += 1;
      else errors.push(`${session.name}: ${result.error || 'Could not save attendance.'}`);
    } catch {
      errors.push(`${session.name}: Could not connect. Please retry.`);
    }
  }
  return { saved, errors };
}
