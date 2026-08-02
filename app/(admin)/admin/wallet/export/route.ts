import { requireStaff, ADMIN_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { gymHasFeature, upgradeMessage } from '@/lib/entitlements';
import { csvFilename, toCsv } from '@/lib/csv';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Nigerian standard VAT rate. The Net/VAT columns assume gross amounts are
// VAT-inclusive (the common case for consumer pricing) — a VAT-registered gym
// can lift these straight into a return; others just ignore the two columns.
const VAT_RATE = 0.075;

type Payment = {
  id: string; amount: number | null; currency: string | null; paystack_reference: string | null;
  payment_method: string | null; payment_date: string | null; created_at: string | null;
  payment_status: string | null; plan_id: string | null; member_id: string | null;
};

// GET /admin/wallet/export — accounting-ready CSV of the gym's payments (staff
// only). Optional filters: ?status=successful and ?from=YYYY-MM-DD&to=YYYY-MM-DD.
// Imports cleanly into Zoho Books / QuickBooks / Sage and covers VAT filing.
export async function GET(req: Request) {
  const { gym } = await requireStaff(ADMIN_ROLES);
  // Tier gate: data exports are Growth+ (enforced here, not just displayed).
  if (!gymHasFeature(gym, 'analytics_exports')) {
    return new Response(upgradeMessage('analytics_exports'), { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const supabase = await createClient();
  const url = new URL(req.url);
  const status = url.searchParams.get('status');       // e.g. 'successful'
  const method = url.searchParams.get('method');        // e.g. 'card', 'bank_transfer'
  const from = url.searchParams.get('from');            // inclusive
  const to = url.searchParams.get('to');                // inclusive (end of day)

  let q = supabase.from('payments')
    .select('id, amount, currency, paystack_reference, payment_method, payment_date, created_at, payment_status, plan_id, member_id')
    .eq('gym_id', gym.id).order('payment_date', { ascending: false }).limit(5000);
  if (status) q = q.eq('payment_status', status);
  if (method) q = q.eq('payment_method', method);
  if (from) q = q.gte('payment_date', `${from}T00:00:00Z`);
  if (to) q = q.lte('payment_date', `${to}T23:59:59Z`);
  const { data: rows } = await q;
  const payments = (rows as Payment[] | null) ?? [];

  const memberIds = [...new Set(payments.map((r) => r.member_id).filter(Boolean) as string[])];
  const planIds = [...new Set(payments.map((r) => r.plan_id).filter(Boolean) as string[])];
  const [{ data: profiles }, { data: plans }] = await Promise.all([
    memberIds.length ? supabase.from('profiles').select('id, full_name, email').in('id', memberIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
    planIds.length ? supabase.from('membership_plans').select('id, name').in('id', planIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const profById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const planById = new Map((plans ?? []).map((p) => [p.id, p.name]));

  const money = (n: number) => n.toFixed(2);
  const header = ['Date', 'Reference', 'Member', 'Email', 'Description', 'Method', 'Currency', 'Amount (gross)', 'Net (ex 7.5% VAT)', 'VAT (7.5%)', 'Status'];
  const body = payments.map((p) => {
    const prof = p.member_id ? profById.get(p.member_id) : undefined;
    const gross = Number(p.amount ?? 0);
    const settled = p.payment_status === 'successful';
    // Only realised (settled) revenue carries a VAT breakdown; pending/failed
    // rows leave those columns blank so totals aren't overstated.
    const net = settled ? gross / (1 + VAT_RATE) : null;
    const vat = settled && net != null ? gross - net : null;
    return [
      (p.payment_date ?? p.created_at ?? '').slice(0, 10),
      p.paystack_reference ?? '',
      prof?.full_name ?? '',
      prof?.email ?? '',
      (p.plan_id && planById.get(p.plan_id)) || 'Payment',
      p.payment_method ?? 'Paystack',
      p.currency ?? 'NGN',
      money(gross),
      net == null ? '' : money(net),
      vat == null ? '' : money(vat),
      p.payment_status ?? '',
    ];
  });

  const csv = toCsv(header, body);
  const filename = csvFilename('accounting', gym.name);

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
