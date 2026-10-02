import { requireApiMember, json, corsPreflight } from '@/lib/api-app';
import { paymentAmounts, paymentStatusLabel } from '@/lib/payment-display';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export function OPTIONS() {
  return corsPreflight();
}

// GET /api/app/wallet/[id] — one receipt.
//
// Scoped to this member AND this gym, so an id guessed from another member's
// payment resolves to nothing rather than to somebody else's receipt. RLS says
// the same thing; the explicit filters mean a policy change can't silently
// widen this route.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiMember(req);
  if (!auth.ok) return auth.res;
  const { supabase, user, gym } = auth.ctx;
  const { id } = await params;

  try {
    const { data: p } = await supabase
      .from('payments')
      .select('id, amount, refunded_amount, payment_status, payment_date, created_at, payment_method, plan_id, paystack_reference')
      .eq('id', id).eq('member_id', user.id).eq('gym_id', gym.id)
      .maybeSingle();
    if (!p) return json({ error: 'Receipt not found.' }, 404);

    let planLabel = 'Membership payment';
    if (p.plan_id) {
      const { data: plan } = await supabase.from('membership_plans').select('name').eq('id', p.plan_id).maybeSingle();
      if (plan?.name) planLabel = plan.name;
    }

    const amounts = paymentAmounts(p);
    return json({
      receipt: {
        id: p.id,
        amount: amounts.net,
        gross_amount: amounts.gross,
        refunded_amount: amounts.refunded,
        refund_state: amounts.refundState,
        status: p.payment_status,
        status_label: paymentStatusLabel(p),
        date: p.payment_date ?? p.created_at,
        method: p.payment_method || 'Paystack',
        reference: p.paystack_reference || p.id,
        plan: planLabel,
        gym: gym.name,
      },
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
