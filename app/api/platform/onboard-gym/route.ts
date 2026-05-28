import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyTransaction } from '@/lib/paystack';
import { sendTempPassword } from '@/lib/email';
import { waTempPassword } from '@/lib/whatsapp';
import { PLATFORM_PRICING, isBillingPeriod } from '@/lib/platform-pricing';
import { rateLimit, rateLimitResponse, clientIpFromRequest, readJsonBody } from '@/lib/rate-limit';

// Completes a gym onboarding once the prospective owner has paid the ₦20k
// platform fee via Paystack. Called from the browser AFTER the inline
// checkout returns a reference. We verify the reference against Paystack
// directly (server-to-server) and then provision the gym.
//
// All state needed to provision is encoded in Paystack metadata when the
// transaction is initiated, so we don't need a pending-signups table.

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;

const DEFAULT_PLANS: Array<{ name: string; duration_months: number; price: number }> = [
  { name: 'Monthly', duration_months: 1, price: 20000 },
  { name: 'Quarterly · save 5%', duration_months: 3, price: 57000 },
  { name: '6 months · save 10%', duration_months: 6, price: 108000 },
  { name: 'Annual · save 17%', duration_months: 12, price: 200000 },
];

function tempPassword(): string {
  return (
    'gf-' +
    Math.random().toString(36).slice(2, 8) +
    '-' +
    Math.random().toString(36).slice(2, 6).toUpperCase()
  );
}

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request);
  const rl = rateLimit({ key: `onboard-gym:${ip}`, limit: 5, windowMs: 60_000 });
  if (!rl.ok) return rateLimitResponse(rl);

  const body = await readJsonBody<{ reference?: string }>(request);
  if (body instanceof Response) return body;
  const reference = body.reference;
  if (!reference) return NextResponse.json({ error: 'reference required' }, { status: 400 });

  let txn: Awaited<ReturnType<typeof verifyTransaction>>;
  try {
    txn = await verifyTransaction(reference);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
  if (txn.status !== 'success') {
    return NextResponse.json({ error: 'Payment not completed' }, { status: 400 });
  }

  const meta = txn.metadata ?? {};
  const purpose = typeof meta === 'object' && meta !== null && 'purpose' in meta ? (meta as { purpose?: unknown }).purpose : null;
  if (purpose !== 'gym_onboarding') {
    return NextResponse.json({ error: 'Wrong transaction purpose' }, { status: 400 });
  }
  const m = meta as Record<string, string | null | undefined>;
  const slug = String(m.slug ?? '').toLowerCase().trim();
  const gymName = String(m.gym_name ?? '').trim();
  const ownerName = String(m.owner_name ?? '').trim();
  const ownerPhone = String(m.owner_phone ?? '').trim();
  const ownerEmail = (txn.customer?.email ?? '').toLowerCase().trim();
  const billing = isBillingPeriod(m.billing) ? m.billing : 'monthly';

  if (!slug || !SLUG_RE.test(slug) || !gymName || !ownerName || !ownerEmail) {
    return NextResponse.json({ error: 'Missing or invalid onboarding metadata' }, { status: 400 });
  }

  // Verify the money actually charged covers the chosen plan, in Naira. The
  // amount/metadata on the inline checkout are client-influenced, so without
  // this a caller could pay ₦1 and have a full subscription provisioned.
  if ((txn.currency ?? 'NGN') !== 'NGN') {
    return NextResponse.json({ error: 'Unsupported payment currency' }, { status: 400 });
  }
  if (Number(txn.amount) < PLATFORM_PRICING[billing].amount * 100) {
    return NextResponse.json({ error: 'Amount paid is less than the plan price' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Idempotency: if we already provisioned this reference, return existing gym.
  const { data: existingPayment } = await admin
    .from('platform_payments')
    .select('id, gym_id, paystack_reference')
    .eq('paystack_reference', reference)
    .maybeSingle();
  if (existingPayment?.gym_id) {
    const { data: g } = await admin.from('gyms').select('slug').eq('id', existingPayment.gym_id).maybeSingle();
    return NextResponse.json({ ok: true, slug: g?.slug ?? slug, alreadyProvisioned: true });
  }

  // 1. Insert gym row
  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + PLATFORM_PRICING[billing].months);
  const { data: gymRow, error: gymError } = await admin
    .from('gyms')
    .insert({
      name: gymName,
      slug,
      email: ownerEmail,
      phone: ownerPhone || null,
      currency: 'NGN',
      subscription_plan: billing,
      subscription_status: 'active',
      status: 'active',
      trial_ends_at: periodEnd.toISOString(),
    })
    .select('id, slug, name')
    .single();
  if (gymError || !gymRow) {
    return NextResponse.json({ error: `Gym create failed: ${gymError?.message ?? 'unknown'}` }, { status: 500 });
  }

  // 2. Create or look up the owner auth user
  let userId: string | null = null;
  const temp = tempPassword();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password: temp,
    email_confirm: true,
    user_metadata: { full_name: ownerName, phone: ownerPhone || null },
  });
  if (createErr) {
    if (/already.*registered|exists/i.test(createErr.message)) {
      // Owner already has an account — resolve via profiles (auth.admin.listUsers
      // is paginated and silently misses lookups past 50 users).
      const { data: existing } = await admin
        .from('profiles')
        .select('id')
        .ilike('email', ownerEmail)
        .maybeSingle();
      userId = existing?.id ?? null;
    } else {
      return NextResponse.json({ error: `Owner create failed: ${createErr.message}` }, { status: 500 });
    }
  } else {
    userId = created?.user?.id ?? null;
  }
  if (!userId) {
    return NextResponse.json({ error: 'Could not resolve owner id' }, { status: 500 });
  }

  // 3. Make sure profile is set up with the gym_owner role
  await admin
    .from('profiles')
    .upsert(
      {
        id: userId,
        email: ownerEmail,
        first_name: ownerName.split(/\s+/)[0],
        last_name: ownerName.split(/\s+/).slice(1).join(' ') || null,
        phone: ownerPhone || null,
        role: 'gym_owner',
        gym_id: gymRow.id,
        is_active: true,
      },
      { onConflict: 'id' },
    );

  // 4. Staff link
  await admin
    .from('gym_staff_links')
    .upsert(
      {
        gym_id: gymRow.id,
        user_id: userId,
        role: 'gym_owner',
        is_active: true,
      },
      { onConflict: 'gym_id,user_id' },
    );

  // 5. Default plans
  await admin.from('membership_plans').insert(
    DEFAULT_PLANS.map((p) => ({
      gym_id: gymRow.id,
      name: p.name,
      duration_months: p.duration_months,
      price: p.price,
      currency: 'NGN',
      is_active: true,
    })),
  );

  // 6. Record platform payment
  await admin.from('platform_payments').insert({
    gym_id: gymRow.id,
    amount: txn.amount / 100,
    payment_status: 'successful',
    paystack_reference: reference,
    billing_period_start: periodStart.toISOString().split('T')[0],
    billing_period_end: periodEnd.toISOString().split('T')[0],
  });

  // 6b. Save the owner's card so the platform-renewals cron can auto-renew
  // the gym's GymFlow subscription. Without this the platform fee is paid
  // exactly once at signup and the gym uses GymFlow free forever.
  const ownerAuth = txn.authorization;
  if (ownerAuth?.reusable && ownerAuth.authorization_code) {
    await admin.from('saved_cards').upsert(
      {
        gym_id: gymRow.id,
        member_id: userId,
        authorization_code: ownerAuth.authorization_code,
        paystack_authorization_code: ownerAuth.authorization_code,
        card_type: ownerAuth.card_type ?? null,
        last4: ownerAuth.last4 ?? null,
        exp_month: ownerAuth.exp_month ?? null,
        exp_year: ownerAuth.exp_year ?? null,
        bank: ownerAuth.bank ?? null,
        brand: ownerAuth.brand ?? null,
        reusable: ownerAuth.reusable ?? true,
        email: ownerEmail,
        is_default: true,
        is_active: true,
      },
      { onConflict: 'member_id,authorization_code' },
    );
  }

  // 7. Notify owner (only if we created them with a temp password)
  if (!createErr) {
    const loginUrl = `https://${gymRow.slug}.gymflow.ng/login`;
    try {
      await Promise.allSettled([
        sendTempPassword(ownerEmail, { name: ownerName, gymName: gymRow.name, tempPassword: temp, loginUrl }),
        ownerPhone
          ? waTempPassword(ownerPhone, { name: ownerName, gymName: gymRow.name, tempPassword: temp, loginUrl })
          : Promise.resolve(),
      ]);
    } catch (e) {
      console.warn('[GF onboard-gym] temp-password notification failed:', (e as Error).message);
    }
  }

  return NextResponse.json({ ok: true, slug: gymRow.slug, name: gymRow.name });
}
