'use server';

import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/gym';
import { getSessionUser } from '@/lib/auth/dal';
import { audit } from '@/lib/audit';

export type AttendanceCsvResult =
  | { ok: true; filename: string; csv: string; rows: number }
  | { ok: false; error: string };

// Same CHECK constraint allowlist as the table — only valid statuses ship
// through to the query, anything else is dropped silently.
const BOOKING_STATUSES = new Set(['booked', 'attended', 'cancelled', 'no_show', 'waitlisted']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const COLUMNS = [
  'booking_date',
  'class_name',
  'class_time',
  'member_name',
  'member_email',
  'member_phone',
  'status',
  'booked_at',
  'cancelled_at',
] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function ago(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Export class attendance for the current gym, optionally filtered by date
 * range, class, and booking status. Useful for instructor pay calculations
 * ("how many sessions did Coach A run?"), no-show pattern analysis, and
 * tax-deductible-employee-benefit reporting in jurisdictions that ask for it.
 *
 * Audited as admin.attendance_exported with the active filter set.
 */
export async function exportAttendanceCsv(
  slug: string,
  filters: { from?: string; to?: string; class_id?: string; status?: string } = {},
): Promise<AttendanceCsvResult> {
  const { gym } = await requireStaff(slug);
  const actor = await getSessionUser();

  const from = filters.from && DATE_RE.test(filters.from) ? filters.from : ago(30);
  const to = filters.to && DATE_RE.test(filters.to) ? filters.to : todayIso();
  // Lightly defensive: class_id should be a uuid; we don't deep-validate but
  // we drop anything with PostgREST .or() / SQL-style characters.
  const classId = filters.class_id && /^[0-9a-f-]{8,}$/i.test(filters.class_id) ? filters.class_id : '';
  const status = filters.status && BOOKING_STATUSES.has(filters.status) ? filters.status : '';

  const supabase = await createClient();
  let q = supabase
    .from('class_bookings')
    .select(
      'id, booking_date, status, booked_at, cancelled_at, member_id, class_id, classes(name), class_schedules(start_time), profiles:member_id(full_name, first_name, email, phone)',
    )
    .eq('gym_id', gym.id)
    .gte('booking_date', from)
    .lte('booking_date', to)
    .order('booking_date', { ascending: false })
    .order('booked_at', { ascending: false })
    .limit(10_000);
  if (classId) q = q.eq('class_id', classId);
  if (status) q = q.eq('status', status);
  const { data: rows } = await q;

  const lines: string[] = [COLUMNS.join(',')];
  for (const r of rows ?? []) {
    const cls = Array.isArray(r.classes) ? r.classes[0] : r.classes;
    const sched = Array.isArray(r.class_schedules) ? r.class_schedules[0] : r.class_schedules;
    const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    const name = profile?.full_name ?? profile?.first_name ?? '';
    lines.push(
      [
        csvCell(r.booking_date),
        csvCell(cls?.name),
        csvCell(sched?.start_time),
        csvCell(name),
        csvCell(profile?.email),
        csvCell(profile?.phone),
        csvCell(r.status),
        csvCell(r.booked_at),
        csvCell(r.cancelled_at),
      ].join(','),
    );
  }

  const csv = lines.join('\n');
  const filename = `${gym.slug}-attendance-${from}_to_${to}.csv`;
  const exportedRows = lines.length - 1;

  await audit({
    gymId: gym.id,
    actorId: actor?.id ?? null,
    action: 'admin.attendance_exported',
    table: 'class_bookings',
    after: {
      row_count: exportedRows,
      filename,
      from,
      to,
      class_id: classId || null,
      status: status || null,
    },
  });

  return { ok: true, filename, csv, rows: exportedRows };
}
