'use client';

import { useState, useTransition } from 'react';
import { CreditCard, Lock, AlertCircle, Repeat, CalendarClock, UserRoundCheck } from 'lucide-react';
import { fmtNaira, fmtDate } from '@/lib/format';
import { startRenewal } from '@/lib/actions/renew';
import { startAutoRenewal } from '@/lib/actions/member-billing';
import { planPeriodLabel, planCadenceLabel, monthlyEquivalent, projectRenewalEnd } from '@/lib/plan-duration';
import { offersTrainer, trainerAddonPrice, planTotalPrice } from '@/lib/plan-addon';

export type Plan = {
  id: string; name: string; price: number; duration_days: number | null; duration_months: number; description: string | null;
  trainer_addon_enabled?: boolean | null; trainer_addon_price?: number | null;
};

// Plan picker — real plans from the server page. "Pay" starts a Paystack
// checkout (startRenewal → authorization_url); the renew callback + webhook
// record the payment and extend the subscription. The auto-renew toggle
// switches to startAutoRenewal, which creates a Paystack Subscription for
// recurring billing (member-sub-fulfill.ts handles the recurring events).
// `currentEnd` is the member's current subscription end date (ISO, or null when
// lapsed/none). A purchase always stacks onto the NEXT period — see
// projectRenewalEnd — so we preview the resulting coverage for the picked plan,
// making clear the member is buying the next period, not the one they're in.
// Said once, next to the tick, because it's the question a member has the
// moment they consider it: they're buying trainer time, not choosing a person.
const gymAssignsNote = 'Your gym matches you with a trainer after you pay';

export function RenewPicker({ plans, currentEnd = null }: { plans: Plan[]; currentEnd?: string | null }) {
  const [picked, setPicked] = useState(plans[0]?.id ?? '');
  const [autoRenew, setAutoRenew] = useState(false);
  // Opting into the gym's private-trainer add-on. Kept per-picker rather than
  // per-plan: switching to a plan that doesn't offer one must not carry a stale
  // tick along, and `withTrainer` below is what actually gates it.
  const [wantTrainer, setWantTrainer] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const sel = plans.find((p) => p.id === picked) ?? plans[0];

  const canAddTrainer = offersTrainer(sel);
  const withTrainer = canAddTrainer && wantTrainer;
  const addonPrice = trainerAddonPrice(sel);
  const total = sel ? planTotalPrice(sel, withTrainer) : 0;

  const activeUntil = currentEnd && new Date(currentEnd).getTime() > Date.now() ? currentEnd : null;
  const projectedEnd = sel ? projectRenewalEnd(currentEnd, sel) : null;

  function pay() {
    if (!sel) return;
    setErr(null);
    start(async () => {
      const res = autoRenew
        ? await startAutoRenewal(sel.id, withTrainer)
        : await startRenewal(sel.id, withTrainer);
      if (res.ok) window.location.href = res.url; // → Paystack checkout
      else setErr(res.error);
    });
  }

  const perMonth = (p: Plan) => monthlyEquivalent(p.price, p);
  const baseline = plans.length ? Math.max(...plans.map(perMonth)) : 0;
  const cheapest = plans.length ? plans.reduce((b, p) => (perMonth(p) < perMonth(b) ? p : b), plans[0]).id : '';

  return (
    <div>
      {plans.map((p) => {
        const save = baseline > 0 ? Math.round((1 - perMonth(p) / baseline) * 100) : 0;
        const badge = p.id === cheapest && plans.length > 1 ? { label: 'Best value', tone: 'accent' } : save >= 5 ? { label: `Save ${save}%`, tone: 'brand' } : null;
        return (
          <button key={p.id} type="button" className={`rplan${picked === p.id ? ' on' : ''}`} onClick={() => setPicked(p.id)} style={{ width: '100%', textAlign: 'left' }} aria-pressed={picked === p.id}>
            <span className="rk" aria-hidden />
            <div className="info">
              <strong>{p.name}{badge && <span className={`gf-badge gf-badge-${badge.tone}`} style={{ marginLeft: 4 }}>{badge.label}</span>}</strong>
              <small>{p.description ?? planCadenceLabel(p)}</small>
            </div>
            <div className="pr">{fmtNaira(p.price)}<small>{planPeriodLabel(p)}</small></div>
          </button>
        );
      })}
      {sel && projectedEnd && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, margin: '14px 2px 2px', padding: '11px 13px', borderRadius: 'var(--gf-radius-sm)', background: 'var(--gf-brand-soft)', border: '1px solid var(--gf-border-glow)', fontSize: '0.83rem', lineHeight: 1.45 }}>
        <CalendarClock strokeWidth={1.9} size={16} style={{ flexShrink: 0, marginTop: 1, color: 'var(--gf-brand)' }} />
          <span>
            {activeUntil
              ? <>You&rsquo;re covered through <strong>{fmtDate(activeUntil)}</strong>. This {sel.name} starts the next period and extends you to <strong>{fmtDate(projectedEnd.toISOString().slice(0, 10))}</strong>.</>
              : <>This {sel.name} covers you through <strong>{fmtDate(projectedEnd.toISOString().slice(0, 10))}</strong>.</>}
          </span>
        </div>
      )}
      {canAddTrainer && (
        // The gym offers a private trainer on this plan. Off by default — it's
        // an extra the member chooses, so it must never be a charge they have
        // to notice and remove.
        <label className="rtrainer">
          <input type="checkbox" checked={wantTrainer} onChange={(e) => setWantTrainer(e.target.checked)} />
          <UserRoundCheck strokeWidth={1.9} size={16} />
          <span className="rtrainer-tx">
            <strong>Add a private trainer</strong>
            <small>{gymAssignsNote}</small>
          </span>
          <span className="rtrainer-pr">{addonPrice > 0 ? `+${fmtNaira(addonPrice)}` : 'Included'}</span>
        </label>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 4px 4px', cursor: 'pointer', fontSize: '0.86rem' }}>
        <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} style={{ margin: 0 }} />
        <Repeat strokeWidth={1.9} size={15} />
        <span>Auto-renew every period (cancel anytime from your profile)</span>
      </label>
      {withTrainer && addonPrice > 0 && sel && (
        // Two numbers went into this total; showing only the sum leaves the
        // member checking our arithmetic against the plan price they just read.
        <div className="rtotal">
          <span>{sel.name}<b>{fmtNaira(sel.price)}</b></span>
          <span>Private trainer<b>+{fmtNaira(addonPrice)}</b></span>
          <span className="rtotal-sum">Total<b>{fmtNaira(total)}</b></span>
        </div>
      )}
      {err && <p style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--gf-danger)', fontSize: '0.84rem', margin: '12px 0 0' }}><AlertCircle size={15} strokeWidth={2} /> {err}</p>}
      <button className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg" style={{ marginTop: 8 }} onClick={pay} disabled={!sel || pending}>
        <CreditCard strokeWidth={1.9} style={{ width: 18, height: 18 }} /> {pending ? 'Starting checkout…' : `Pay ${sel ? fmtNaira(total) : ''} with Paystack`}
      </button>
      <div className="paysafe"><Lock strokeWidth={1.9} /> Secured by Paystack</div>
    </div>
  );
}
