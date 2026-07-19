import { describe, expect, it } from 'vitest';
import {
  tierOf, tierHasFeature, gymHasFeature, featuresFor, requiredTier, type Feature,
} from '@/lib/entitlements';

// Pure unit tests for the plan→feature matrix. This encodes the public pricing
// page (app/pricing/page.tsx) — if the two drift, one of them is wrong.

describe('tierOf', () => {
  it('reads a valid subscription_plan', () => {
    expect(tierOf({ subscription_plan: 'growth' })).toBe('growth');
    expect(tierOf({ subscription_plan: 'scale' })).toBe('scale');
  });
  it('falls back to starter for null / unknown (never strips a paying gym silently)', () => {
    expect(tierOf({ subscription_plan: null })).toBe('starter');
    expect(tierOf({ subscription_plan: 'enterprise' })).toBe('starter');
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
  it('Growth: everything in Starter + scheduling, WhatsApp, analytics/exports', () => {
    expect(tierHasFeature('growth', 'qr_checkin')).toBe(true);
    expect(tierHasFeature('growth', 'class_scheduling')).toBe(true);
    expect(tierHasFeature('growth', 'whatsapp_reminders')).toBe(true);
    expect(tierHasFeature('growth', 'analytics_exports')).toBe(true);
    expect(tierHasFeature('growth', 'multi_gym')).toBe(false);
    expect(tierHasFeature('growth', 'instructor_payouts')).toBe(false);
  });
  it('Scale: everything', () => {
    for (const f of featuresFor('scale')) expect(tierHasFeature('scale', f)).toBe(true);
    expect(tierHasFeature('scale', 'multi_gym')).toBe(true);
    expect(tierHasFeature('scale', 'instructor_payouts')).toBe(true);
    expect(tierHasFeature('scale', 'priority_support')).toBe(true);
  });
});

describe('feature inclusion is monotonic up the tiers', () => {
  it('every Starter feature is in Growth, every Growth feature is in Scale', () => {
    const s = new Set(featuresFor('starter'));
    const g = new Set(featuresFor('growth'));
    const sc = new Set(featuresFor('scale'));
    for (const f of s) expect(g.has(f)).toBe(true);
    for (const f of g) expect(sc.has(f)).toBe(true);
    expect(featuresFor('scale').length).toBeGreaterThan(featuresFor('growth').length);
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
    expect(requiredTier('instructor_payouts')).toBe('scale');
    expect(requiredTier('qr_checkin')).toBe('starter');
  });
  it('every Feature has a required tier that actually unlocks it', () => {
    const all: Feature[] = ['qr_checkin', 'paystack_subscriptions', 'email_reminders', 'class_scheduling', 'whatsapp_reminders', 'analytics_exports', 'multi_gym', 'instructor_payouts', 'priority_support'];
    for (const f of all) expect(tierHasFeature(requiredTier(f), f)).toBe(true);
  });
});
