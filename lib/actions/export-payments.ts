'use server';

import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/gym';
import { getSessionUser } from '@/lib/auth/dal';
import { audit } from '@/lib/audit';

export type PaymentsCsvResult =
  | { ok: true; filename: string; csv: string; rows: number }
  | { ok: false; error: string };

// Allowlists matching the schema's CHECK constraints — anything else is
// dropped silently so the URL can't ship a malformed value to the query.
const PAYMENT_METHODS = new Set(['card', 'bank_transfer', 'cash', 'crypto']);
const PAYMENT_STATUSES = new Set(['pending', 'successful', 'failed', 'refunded']);

// Date validator. ISO YYYY-MM-DD strict — the wallet page already produces
// these via daysAgoDate / todayDate; we accept nothing else.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const COLUMNS = [
  'payment_date',
  'reference',
  'member_name',
  'member_email',
  'plan',
  'method',
  'status',
  'currency',
  'amount',
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
 * Export every payment in the chosen date range as CSV. Honours the same
 * from / to / method / status filters as the wallet page so "what I see is
 * what I download". Audited as admin.payments_exported with the row count
 * and the active filter set.
 */
export async function exportPaymentsCsv(
  slug: string,
  filters: { from?: string; to?: string; method?: string; status?: string } = {},
): Promise<PaymentsCsvResult> {
  const { gym } = await requireStaff(slug);
  const actor = await getSessionUser();

  // Clamp inputs to sane defaults — same fallback shape as the wallet page.
  const from = filters.from && DATE_RE.test(filters.from) ? filters.from : ago(30);
  const to = filters.to && DATE_RE.test(filters.to) ? filters.to : todayIso();
  const method = filters.method && PAYMENT_METHODS.has(filters.method) ? filters.method : '';
  const status = filters.status && PAYMENT_STATUSES.has(filters.status) ? filters.status : '';

  const supabase = await createClient();
  // gte(from 00:00:00) and lte(to 23:59:59) so a one-day range includes the
  // whole "to" day instead of cutting off at midnight.
  let q = supabase
    .from('payments')
    .select('id, payment_date, payment_method, payment_status, amount, currency, paystack_reference, member_id, plan_id, profiles:member_id(full_name, first_name, email), membership_plans:plan_id(name)')
    .eq('gym_id', gym.id)
    .gte('payment_date', new Date(from + 'T00:00:00Z').toISOString())
    .lte('payment_date', new Date(new Date(to + 'T00:00:00Z').getTime() + DAY_MS).toISOString())
    .order('payment_date', { ascending: false })
    .limit(10_000);
  if (method) q = q.eq('payment_method', method);
  if (status) q = q.eq('payment_status', status);
  const { data: rows } = await q;

  const lines: string[] = [COLUMNS.join(',')];
  for (const p of rows ?? []) {
    const profile = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
    const plan = Array.isArray(p.membership_plans) ? p.membership_plans[0] : p.membership_plans;
    const name = profile?.full_name ?? profile?.first_name ?? '';
    lines.push(
      [
        csvCell(p.payment_date),
        csvCell(p.paystack_reference),
        csvCell(name),
        csvCell(profile?.email),
        csvCell(plan?.name),
        csvCell(p.payment_method),
        csvCell(p.payment_status),
        csvCell(p.currency),
        csvCell(p.amount),
      ].join(','),
    );
  }

  const csv = lines.join('\n');
  const filename = `${gym.slug}-payments-${from}_to_${to}.csv`;
  const exportedRows = lines.length - 1;

  await audit({
    gymId: gym.id,
    actorId: actor?.id ?? null,
    action: 'admin.payments_exported',
    table: 'payments',
    after: { row_count: exportedRows, filename, from, to, method: method || null, status: status || null },
  });

  return { ok: true, filename, csv, rows: exportedRows };
}
