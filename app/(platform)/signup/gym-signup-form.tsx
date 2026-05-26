'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { useToast } from '@/lib/toast';
import { PLATFORM_PRICING, formatNaira, type BillingPeriod } from '@/lib/platform-pricing';

type SlugState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok' }
  | { status: 'bad'; reason: string };

declare global {
  interface Window {
    PaystackPop?: {
      newTransaction: (opts: {
        key: string;
        email: string;
        amount: number;
        currency: string;
        ref: string;
        metadata: Record<string, unknown>;
        subaccount?: string;
        bearer?: 'account' | 'subaccount';
        onSuccess: (txn: { reference: string }) => void;
        onClose: () => void;
      }) => void;
    };
  }
}

export function GymSignupForm() {
  const router = useRouter();
  const toast = useToast();
  const [scriptReady, setScriptReady] = useState(() => typeof window !== 'undefined' && !!window.PaystackPop);
  const [pending, start] = useTransition();
  const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY;

  const [gymName, setGymName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [slug, setSlug] = useState('');
  const [billing, setBilling] = useState<BillingPeriod>('monthly');
  // Lookup is keyed by slug so render derives state without setState-in-effect.
  const [slugLookup, setSlugLookup] = useState<{ slug: string; ok: boolean; reason?: string } | null>(null);

  const trimmedSlug = slug.trim();

  useEffect(() => {
    if (!trimmedSlug) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/platform/check-slug?slug=${encodeURIComponent(trimmedSlug)}`, { signal: ctl.signal });
        const j = await r.json();
        if (!ctl.signal.aborted) {
          setSlugLookup({ slug: trimmedSlug, ok: !!j.available, reason: j.reason ?? undefined });
        }
      } catch {
        // ignored — user is still typing
      }
    }, 400);
    return () => {
      ctl.abort();
      clearTimeout(t);
    };
  }, [trimmedSlug]);

  const slugState: SlugState = !trimmedSlug
    ? { status: 'idle' }
    : slugLookup?.slug === trimmedSlug
      ? (slugLookup.ok ? { status: 'ok' } : { status: 'bad', reason: slugLookup.reason ?? 'unavailable' })
      : { status: 'checking' };

  const slugHelp =
    slugState.status === 'idle'
      ? 'Lowercase letters, numbers and dashes. This becomes <slug>.gymflow.ng.'
      : slugState.status === 'checking'
        ? 'Checking availability…'
        : slugState.status === 'ok'
          ? '✓ Available'
          : slugState.status === 'bad' && slugState.reason === 'taken'
            ? '✕ Already taken'
            : slugState.status === 'bad' && slugState.reason === 'reserved'
              ? '✕ Reserved name'
              : '✕ Use lowercase letters, numbers and dashes only';

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!publicKey) {
      toast('Paystack public key not configured', 'error');
      return;
    }
    if (slugState.status !== 'ok') {
      toast('Pick an available subdomain first', 'warning');
      return;
    }
    start(async () => {
      // 1. ask the server to initiate, so we don't expose secret keys.
      const initRes = await fetch('/api/platform/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gymName, ownerEmail, ownerName, ownerPhone, slug, billing }),
      });
      const init = await initRes.json();
      if (!initRes.ok) {
        toast(init.error ?? 'Could not start payment', 'error');
        return;
      }

      if (!window.PaystackPop) {
        toast('Payment library still loading — try again in a moment', 'warning');
        return;
      }

      window.PaystackPop.newTransaction({
        key: publicKey,
        email: ownerEmail,
        amount: PLATFORM_PRICING[billing].amount * 100,
        currency: 'NGN',
        ref: init.reference,
        metadata: {
          purpose: 'gym_onboarding',
          slug,
          gym_name: gymName,
          owner_name: ownerName,
          owner_phone: ownerPhone,
          billing,
        },
        onSuccess: async (txn) => {
          const onboardRes = await fetch('/api/platform/onboard-gym', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reference: txn.reference }),
          });
          const onboard = await onboardRes.json();
          if (!onboardRes.ok) {
            toast(onboard.error ?? 'Onboarding failed', 'error');
            return;
          }
          toast(`${onboard.name ?? 'Your gym'} is live!`, 'success');
          router.push(`/signup/done?slug=${encodeURIComponent(onboard.slug)}`);
        },
        onClose: () => toast('Payment closed', 'info'),
      });
    });
  }

  return (
    <>
      <Script
        src="https://js.paystack.co/v2/inline.js"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />
      <form className="gf-form-stack" onSubmit={onSubmit}>
        <div className="gf-form-group">
          <label className="gf-form-label" htmlFor="gym_name">Gym name</label>
          <input id="gym_name" required className="gf-input" placeholder="e.g. Powerhouse Lagos" value={gymName} onChange={(e) => setGymName(e.target.value)} />
        </div>
        <div className="gf-form-group">
          <label className="gf-form-label" htmlFor="slug">Subdomain</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              id="slug"
              required
              className="gf-input"
              placeholder="powerhouse-lagos"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              maxLength={32}
            />
            <span className="gf-form-hint" style={{ whiteSpace: 'nowrap' }}>.gymflow.ng</span>
          </div>
          <p className="gf-form-hint" style={{ color: slugState.status === 'ok' ? 'var(--gf-brand)' : slugState.status === 'bad' ? 'var(--gf-danger)' : 'var(--gf-text-muted)' }}>
            {slugHelp}
          </p>
        </div>
        <div className="gf-form-group">
          <label className="gf-form-label" htmlFor="owner_name">Your name</label>
          <input id="owner_name" required className="gf-input" placeholder="Full name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
        </div>
        <div className="gf-form-group">
          <label className="gf-form-label" htmlFor="owner_email">Your email</label>
          <input id="owner_email" required type="email" className="gf-input" placeholder="you@example.com" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
          <p className="gf-form-hint">We&apos;ll email you a temporary password after payment.</p>
        </div>
        <div className="gf-form-group">
          <label className="gf-form-label" htmlFor="owner_phone">WhatsApp number (Nigeria)</label>
          <input id="owner_phone" type="tel" className="gf-input" placeholder="08012345678" value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} />
        </div>

        <div className="gf-form-group">
          <label className="gf-form-label">Billing</label>
          <div className="mk-billing-toggle">
            {(['monthly', 'annual'] as const).map((b) => {
              const p = PLATFORM_PRICING[b];
              const monthlyEquivalent = b === 'annual' ? Math.round(p.amount / 12) : null;
              return (
                <button
                  type="button"
                  key={b}
                  className={`mk-billing-option${billing === b ? ' active' : ''}`}
                  aria-pressed={billing === b}
                  onClick={() => setBilling(b)}
                >
                  <span className="mk-billing-name">{p.label}</span>
                  <span className="mk-billing-price">
                    {formatNaira(p.amount)}
                    <span className="mk-billing-per">/{b === 'annual' ? 'yr' : 'mo'}</span>
                  </span>
                  {b === 'annual' && (
                    <span className="gf-badge gf-badge-accent mk-billing-save">
                      Save {formatNaira(PLATFORM_PRICING.monthly.amount * 12 - p.amount)}
                    </span>
                  )}
                  {monthlyEquivalent && (
                    <span className="mk-billing-eq">≈ {formatNaira(monthlyEquivalent)}/mo</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="submit"
          disabled={pending || slugState.status !== 'ok' || !scriptReady}
          className="gf-btn gf-btn-primary gf-btn-full gf-btn-lg"
        >
          {pending
            ? 'Connecting to Paystack…'
            : !scriptReady
              ? 'Loading payment…'
              : `Pay ${formatNaira(PLATFORM_PRICING[billing].amount)} & launch`}
        </button>
      </form>
    </>
  );
}
