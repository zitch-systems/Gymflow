import type { Route } from 'next';
import Link from 'next/link';
import { CheckCircle2, Circle, AlertCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

export type OnboardingStep = {
  key: string;
  label: string;
  done: boolean;
  href: Route;
};

// Computes onboarding completeness for a gym. A gym is "onboarded" once every
// step is done — until then, the sticky banner above the admin shell nudges
// the owner to finish. Cheap: a few head-count reads on already-indexed columns.
export async function computeOnboarding(gymId: string): Promise<{ steps: OnboardingStep[]; done: number; total: number }> {
  const supabase = await createClient();
  const [{ data: gym }, { count: plans }, { count: classes }, { data: hours }] = await Promise.all([
    supabase.from('gyms').select('name, address, city, phone, logo_url, brand_color, description, tagline, payouts_locked, paystack_subaccount_code').eq('id', gymId).maybeSingle(),
    supabase.from('membership_plans').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).eq('is_active', true),
    supabase.from('classes').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).eq('is_active', true),
    supabase.from('business_hours').select('day_of_week').eq('gym_id', gymId).limit(1),
  ]);

  const g = (gym as {
    name: string | null; address: string | null; city: string | null; phone: string | null;
    logo_url: string | null; brand_color: string | null; description: string | null; tagline: string | null;
    payouts_locked: boolean | null; paystack_subaccount_code: string | null;
  } | null) ?? null;

  const steps: OnboardingStep[] = [
    {
      key: 'profile',
      label: 'Complete your gym profile',
      done: !!g && !!g.address && !!g.city && !!g.phone && !!(g.tagline || g.description),
      href: '/admin/settings?onboarding=profile' as Route,
    },
    {
      key: 'branding',
      label: 'Upload a logo and pick a brand colour',
      done: !!g?.logo_url && !!g?.brand_color,
      href: '/admin/settings?onboarding=branding' as Route,
    },
    {
      key: 'hours',
      label: 'Set your business hours',
      done: (hours?.length ?? 0) > 0,
      href: '/admin/settings?onboarding=hours' as Route,
    },
    {
      key: 'pricing',
      label: 'Add at least one membership plan',
      done: (plans ?? 0) > 0,
      href: '/admin/pricing',
    },
    {
      key: 'classes',
      label: 'Add at least one class',
      done: (classes ?? 0) > 0,
      href: '/admin/classes',
    },
    {
      key: 'payouts',
      label: 'Connect your payout account',
      done: !!g?.payouts_locked || !!g?.paystack_subaccount_code,
      href: '/admin/settings?onboarding=payouts' as Route,
    },
  ];

  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length };
}

// Sticky top banner shown on every /admin/* page until every step is done.
// Not dismissable by design — the ask was "only go away when they've
// completed onboarding".
export async function OnboardingBanner({ gymId }: { gymId: string }) {
  const { steps, done, total } = await computeOnboarding(gymId);
  if (done >= total) return null;
  const nextStep = steps.find((s) => !s.done);
  return (
    <div className="onboarding-banner" role="status">
      <div className="ob-in">
        <div className="ob-head">
          <AlertCircle strokeWidth={2} size={20} aria-hidden />
          <div>
            <strong>Finish setting up your gym</strong>
            <span className="ob-sub">{done} of {total} done · <Link href={nextStep!.href}>next: {nextStep!.label.toLowerCase()}</Link></span>
          </div>
        </div>
        <div className="ob-progress" aria-hidden><span style={{ width: `${Math.round((done / total) * 100)}%` }} /></div>
        <ul className="ob-steps">
          {steps.map((s) => (
            <li key={s.key} className={s.done ? 'done' : undefined}>
              {s.done ? <CheckCircle2 size={15} strokeWidth={2} /> : <Circle size={15} strokeWidth={2} />}
              {s.done ? <span>{s.label}</span> : <Link href={s.href}>{s.label}</Link>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
