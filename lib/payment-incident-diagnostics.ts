import 'server-only';
import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyTransaction } from '@/lib/paystack';
import { planFromCharge } from '@/lib/platform-charge';

type Admin = ReturnType<typeof createAdminClient>;
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const hint = (value: unknown): string | null => typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
const uuid = (value: unknown): string | null => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);

async function gyms(admin: Admin, column: 'id' | 'paystack_customer_code' | 'paystack_subscription_code', value: string | null): Promise<string[]> {
  if (!value) return [];
  const { data, error } = await admin.from('gyms').select('id').eq(column, value).limit(2);
  if (error) throw new Error('Mapping lookup unavailable');
  return (data ?? []).map(row => row.id);
}

export function ownershipEvidence(subscription: string[], customer: string[], metadata: string[]) {
  if ([subscription, customer, metadata].some(matches => matches.length > 1)) {
    return { state: 'ambiguous', id: null } as const;
  }
  const sub = subscription.length === 1 ? subscription[0] : null;
  const cus = customer.length === 1 ? customer[0] : null;
  const meta = metadata.length === 1 ? metadata[0] : null;
  if ((sub && cus && sub !== cus) || ((sub ?? cus) && meta && (sub ?? cus) !== meta)) {
    return { state: 'conflicting', id: null } as const;
  }
  if (sub) return { state: 'subscription', id: sub } as const;
  if (cus) return { state: 'customer', id: cus } as const;
  if (meta) return { state: 'metadata', id: meta } as const;
  return { state: 'missing', id: null } as const;
}

async function inspectReference(admin: Admin, reference: string, incidentCount: number) {
  const base = { reference_digest: digest(reference), incident_count: incidentCount };
  try {
    const verified = await verifyTransaction(reference);
    if (!verified.ok) return { ...base, provider: 'lookup_failed' };
    if (verified.reference !== reference) return { ...base, provider: 'reference_mismatch' };
    const data = object(verified.memberEventData);
    const meta = object(verified.metadata);
    const subscriptionCode = hint(data.subscription_code) ?? hint(object(data.subscription).subscription_code);
    const customerCode = hint(object(data.customer).customer_code);
    const metadataGym = uuid(meta.gym_id);
    const [subscription, customer, metadata, memberRows, platformRows] = await Promise.all([
      gyms(admin, 'paystack_subscription_code', subscriptionCode),
      gyms(admin, 'paystack_customer_code', customerCode),
      gyms(admin, 'id', metadataGym),
      admin.from('payments').select('gym_id, amount, currency, payment_status').eq('paystack_reference', reference).limit(2),
      admin.from('platform_payments').select('gym_id, amount, currency, payment_status').eq('paystack_reference', reference).limit(2),
    ]);
    if (memberRows.error || platformRows.error) throw new Error('Local payment lookup unavailable');
    const ownership = ownershipEvidence(subscription, customer, metadata);
    const plan = planFromCharge(meta, object(data.plan));
    const local = [...(memberRows.data ?? []), ...(platformRows.data ?? [])];
    const single = local.length === 1 ? local[0] : null;
    // Only fixed labels, counts, booleans and a truncated reference hash
    // leave the runtime. No provider bodies, IDs, amounts or customer data.
    return {
      ...base,
      provider: verified.status === 'success' ? 'success' : 'not_successful',
      currency_ngn: verified.currency === 'NGN',
      metadata_kind: meta.kind === 'platform_subscription' ? 'platform_subscription'
        : meta.kind === 'member_subscription' ? 'member_subscription' : 'other_or_absent',
      plan_present: Boolean(hint(object(data.plan).plan_code)),
      recognized_platform_plan: Boolean(plan),
      platform_plan_amount_matches: plan ? plan.expectedKobo === verified.amountKobo : null,
      subscription_present: Boolean(subscriptionCode),
      customer_present: Boolean(customerCode),
      metadata_gym_present: Boolean(hint(meta.gym_id)),
      metadata_gym_exists: metadata.length === 1,
      subscription_gym_matches: subscription.length,
      customer_gym_matches: customer.length,
      ownership: ownership.state,
      local_member_payments: memberRows.data?.length ?? 0,
      local_platform_payments: platformRows.data?.length ?? 0,
      local_amount_matches: single ? Math.round(Number(single.amount) * 100) === verified.amountKobo : null,
      local_currency_matches: single ? single.currency === verified.currency : null,
      local_record_successful: single ? single.payment_status === 'successful' || single.payment_status === 'success' : null,
      local_gym_matches: single && ownership.id ? single.gym_id === ownership.id : null,
    };
  } catch {
    return { ...base, provider: 'diagnostic_unavailable' };
  }
}

/** Read-only, bounded evidence for the expiring release audit. This never
 * fulfills charges, changes mappings, requeues jobs or resolves incidents. */
export async function paymentIncidentSnapshot() {
  const admin = createAdminClient();
  const { data, error } = await admin.from('operational_incidents' as never)
    .select('reference').is('resolved_at', null).not('reference', 'is', null)
    .in('kind', ['reconciliation: local references unknown at Paystack', 'reconciliation: Paystack charges missing locally',
      'paystack webhook platform failed', 'paystack recovery requires operator repair'])
    .order('first_seen_at', { ascending: true }).limit(21);
  if (error) throw new Error('Payment incident inspection unavailable');
  const rows = (data ?? []) as unknown as Array<{ reference: unknown }>;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const reference = hint(row.reference);
    if (reference) counts.set(reference, (counts.get(reference) ?? 0) + 1);
  }
  const selected = [...counts].slice(0, 8);
  const results = [];
  // Two provider requests at a time; verifyTransaction has a 15-second timeout.
  for (let i = 0; i < selected.length; i += 2) {
    results.push(...await Promise.all(selected.slice(i, i + 2).map(([ref, count]) => inspectReference(admin, ref, count))));
  }
  return { read_only: true, truncated: rows.length > 20 || counts.size > 8, checked: results.length, results };
}
