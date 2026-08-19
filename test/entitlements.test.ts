import { describe, expect, it } from 'vitest';
import {
  tierOf, tierHasFeature, gymHasFeature, gymCanUse, featuresFor, requiredTier, type Feature,
} from '@/lib/entitlements';

// Pure unit tests for the plan→feature matrix. This encodes the public pricing
// page (app/pricing/page.tsx) — if the two drift, one of them is wrong.

describe('tierOf', () => {
  it('reads a valid subscription_plan', () => {
    expect(tierOf({ subscription_plan: 'growth' })).toBe('growth');
    expect(tierOf({ subscription_plan: 'starter' })).toBe('starter');
  });
  it('falls back to starter for null / unknown (never strips a paying gym silently)', () => {
    expect(tierOf({ subscription_plan: null })).toBe('starter');
    expect(tierOf({ subscription_plan: 'enterprise' })).toBe('starter');
  });
  it('treats the retired Scale tier as unknown', () => {
    // The migration rewrites 'scale' → 'growth'; a row that somehow still reads
    // 'scale' is not a tier any more and must not be honoured as the top one.
    expect(tierOf({ subscription_plan: 'scale' })).toBe('starter');
  });
});

describe('tierHasFeature — pricing matrix', () => {
  it('Starter: check-in, subscriptions, email reminders only', () => {
    expect(tierHasFeature('starter', 'qr_checkin')).toBe(true);
    expect(tierHasFeature('starter', 'paystack_subscriptions')).toBe(true);
    expect(tierHasFeature('starter', 'email_reminders')).toBe(true);
    expect(tierHasFeature('starter', 'class_scheduling')).toBe(false);
    expect(tierHasFeature('starter', 'analytics_exports')).toBe(false);
    expect(tierHasFeature('starter', 'instructor_payouts')).toBe(false);
  });
  it('Starter is the admin portal only — no member app, no instructor portal', () => {
    expect(tierHasFeature('starter', 'member_app')).toBe(false);
    expect(tierHasFeature('starter', 'instructor_portal')).toBe(false);
    expect(tierHasFeature('starter', 'ai_assistant')).toBe(false);
  });
  it('Growth: everything — including what Scale used to gate', () => {
    for (const f of featuresFor('growth')) expect(tierHasFeature('growth', f)).toBe(true);
    expect(tierHasFeature('growth', 'class_scheduling')).toBe(true);
    expect(tierHasFeature('growth', 'whatsapp_reminders')).toBe(true);
    expect(tierHasFeature('growth', 'ai_assistant')).toBe(true);
    expect(tierHasFeature('growth', 'analytics_exports')).toBe(true);
    expect(tierHasFeature('growth', 'multi_gym')).toBe(true);
    expect(tierHasFeature('growth', 'instructor_payouts')).toBe(true);
    expect(tierHasFeature('growth', 'instructor_portal')).toBe(true);
    expect(tierHasFeature('growth', 'member_app')).toBe(true);
    expect(tierHasFeature('growth', 'priority_support')).toBe(true);
  });
});

describe('feature inclusion is monotonic up the tiers', () => {
  it('every Starter feature is in Growth, and Growth adds more', () => {
    const s = new Set(featuresFor('starter'));
    const g = new Set(featuresFor('growth'));
    for (const f of s) expect(g.has(f)).toBe(true);
    expect(featuresFor('growth').length).toBeGreaterThan(featuresFor('starter').length);
  });
});

describe('gymHasFeature + requiredTier', () => {
  it('gymHasFeature reads the gym row', () => {
    expect(gymHasFeature({ subscription_plan: 'starter' }, 'analytics_exports')).toBe(false);
    expect(gymHasFeature({ subscription_plan: 'growth' }, 'analytics_exports')).toBe(true);
  });
  it('requiredTier names the upgrade target', () => {
    expect(requiredTier('analytics_exports')).toBe('growth');
    expect(requiredTier('instructor_payouts')).toBe('growth');
    expect(requiredTier('qr_checkin')).toBe('starter');
  });
  it('every Feature has a required tier that actually unlocks it', () => {
    const all: Feature[] = [
      'qr_checkin', 'paystack_subscriptions', 'email_reminders', 'class_scheduling', 'whatsapp_reminders',
      'ai_assistant', 'analytics_exports', 'multi_gym', 'instructor_payouts', 'instructor_portal', 'member_app',
      'priority_support',
    ];
    for (const f of all) expect(tierHasFeature(requiredTier(f), f)).toBe(true);
  });
});

describe('gymCanUse — legacy_full_access grandfather', () => {
  it('a Starter gym without the flag is denied the newly Growth-gated surfaces, same as gymHasFeature', () => {
    const gym = { subscription_plan: 'starter', legacy_full_access: false };
    expect(gymCanUse(gym, 'member_app')).toBe(false);
    expect(gymCanUse(gym, 'instructor_portal')).toBe(false);
    expect(gymCanUse(gym, 'ai_assistant')).toBe(false);
    expect(gymCanUse(gym, 'whatsapp_reminders')).toBe(false);
  });
  it('a legacy Starter gym keeps the member app, instructor portal, AI assistant and WhatsApp console', () => {
    const gym = { subscription_plan: 'starter', legacy_full_access: true };
    expect(gymCanUse(gym, 'member_app')).toBe(true);
    expect(gymCanUse(gym, 'instructor_portal')).toBe(true);
    expect(gymCanUse(gym, 'ai_assistant')).toBe(true);
    expect(gymCanUse(gym, 'whatsapp_reminders')).toBe(true);
  });
  it('the grandfather never extends to features that were already Growth-only before the repositioning', () => {
    // A legacy Starter gym was never entitled to these — the flag must not
    // accidentally widen into features it predates.
    const gym = { subscription_plan: 'starter', legacy_full_access: true };
    expect(gymCanUse(gym, 'analytics_exports')).toBe(false);
    expect(gymCanUse(gym, 'class_scheduling')).toBe(false);
    expect(gymCanUse(gym, 'multi_gym')).toBe(false);
    expect(gymCanUse(gym, 'instructor_payouts')).toBe(false);
    expect(gymCanUse(gym, 'priority_support')).toBe(false);
  });
  it('missing/undefined legacy_full_access reads as false, not as an error', () => {
    expect(gymCanUse({ subscription_plan: 'starter' }, 'member_app')).toBe(false);
    expect(gymCanUse({ subscription_plan: 'starter', legacy_full_access: null }, 'member_app')).toBe(false);
  });
  it('a Growth gym needs no grandfathering — gymCanUse agrees with gymHasFeature either way', () => {
    for (const legacy of [true, false]) {
      const gym = { subscription_plan: 'growth', legacy_full_access: legacy };
      expect(gymCanUse(gym, 'member_app')).toBe(true);
      expect(gymCanUse(gym, 'instructor_portal')).toBe(true);
    }
  });
});
