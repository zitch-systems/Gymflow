import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The platform console's three cross-tenant surfaces: the defaults new gyms are
// provisioned on, the AI provider catalogue, and the shared WhatsApp channel.
//
// Everything here is a write that reaches ACROSS tenants — a commission rate, a
// vendor key GymFlow pays for, whether a gym's members can reach it on
// WhatsApp at all. None of it is reachable by a gym owner, and none of it may
// become reachable by accident, so the properties that make that true are
// pinned here rather than left to a reviewer noticing.
//
// It also pins the thing that started this: /superadmin/settings used to render
// a hardcoded, disabled "3%" left over from the design prototype. GymFlow's own
// console stated a commission rate GymFlow does not charge, and nothing in the
// type system or the test suite objected.

const root = (...p: string[]) => resolve(__dirname, '..', ...p);
const read = (path: string) => readFileSync(root(path), 'utf8');

const ACTION_FILES = [
  'lib/actions/platform-settings.ts',
  'lib/actions/platform-whatsapp.ts',
];

describe('platform console actions', () => {
  for (const file of ACTION_FILES) {
    const src = read(file);
    // Server Actions are POST endpoints with a public URL. An exported async
    // function here that forgets its gate is a cross-tenant write anyone with a
    // session can call.
    const exported = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);

    it(`${file} exports at least one action`, () => {
      expect(exported.length).toBeGreaterThan(0);
    });

    it(`${file}: every action gates on requirePlatformAdmin`, () => {
      for (const name of exported) {
        const start = src.indexOf(`export async function ${name}`);
        const next = exported
          .map((n) => src.indexOf(`export async function ${n}`))
          .filter((i) => i > start)
          .sort((a, b) => a - b)[0] ?? src.length;
        expect(src.slice(start, next), `${name} must call requirePlatformAdmin()`).toContain('requirePlatformAdmin');
      }
    });

    it(`${file}: writes go through the service-role client`, () => {
      // The RLS-scoped client would silently return zero rows here: a platform
      // admin is not staff at any gym, so the tenant policies exclude them.
      expect(src).toContain('createAdminClient');
    });

    it(`${file}: every action is audited`, () => {
      expect(src).toContain('logAudit');
    });
  }

  it('provider keys are encrypted, never logged, and never returned', () => {
    const src = read('lib/actions/platform-settings.ts');
    expect(src).toContain('encryptSecret');
    // A key must not ride back to the browser in the action's result, and the
    // audit trail records that a key changed, not what it changed to.
    // The audit trail records THAT a key changed, never the key: the only
    // mention of `apiKey` in the logged values may be the boolean derived from
    // it, and no field may carry it through.
    const auditBlock = src.slice(src.indexOf('ai_provider_configured'), src.indexOf('ai_provider_configured') + 400);
    expect(auditBlock).toContain('key_changed: Boolean(apiKey)');
    expect(auditBlock).not.toMatch(/:\s*apiKey\b/);
    expect(auditBlock).not.toContain('api_key:');
    // Nor does it ride back to the browser inside a success message.
    expect(src).not.toMatch(/\$\{apiKey/);
  });

  it('a save with an empty key field leaves the stored key alone', () => {
    // Otherwise editing only the model would wipe the credential by omission,
    // and every gym riding the platform key would stop answering.
    const src = read('lib/actions/platform-settings.ts');
    expect(src).toMatch(/if \(apiKey\) \{/);
    expect(src).toContain('clearProviderKey');
  });

  it('a provider that needs more than an API key cannot be enabled', () => {
    const src = read('lib/actions/platform-settings.ts');
    expect(src).toMatch(/enabled && !providerUsable\(slug\)/);
  });
});

describe('platform defaults', () => {
  it('both provisioning paths read the stored defaults', () => {
    // These two disagreed before platform_settings existed: onboard.ts wrote
    // the code constant and provision.ts set no commission at all, so a gym's
    // rate depended on which door it came through.
    for (const file of ['lib/actions/onboard.ts', 'lib/provision.ts']) {
      const src = read(file);
      expect(src, `${file} must read platform settings`).toContain('getPlatformSettings');
      expect(src, `${file} must set a commission explicitly`).toContain('platform_commission_pct: defaults.defaultCommissionPct');
      expect(src, `${file} must not hardcode the trial window`).toContain('trialEndsAt(defaults.defaultTrialDays)');
    }
  });

  it('a failed settings read never blocks provisioning', () => {
    const src = read('lib/platform-settings.ts');
    expect(src).toContain('catch');
    expect(src).toContain('FALLBACK_SETTINGS');
  });

  it('the settings page renders live values, not the prototype mock', () => {
    const src = read('app/(superadmin)/superadmin/settings/page.tsx');
    expect(src).toContain('getPlatformSettings');
    expect(src).toContain('PlatformDefaultsForm');
    // The exact regression: a disabled input hardcoded to a rate nobody pays.
    expect(src).not.toContain('value="3%"');
    expect(src).not.toContain('value="14 days"');
  });

  it('the defaults form posts to the real action', () => {
    const src = read('app/(superadmin)/superadmin/settings/defaults-form.tsx');
    expect(src).toContain('setPlatformDefaults');
    expect(src).toMatch(/name="default_commission_pct"/);
    expect(src).toMatch(/name="default_trial_days"/);
    // Read-only inputs are what the mock was. A control the operator can see
    // but not change is worse than no control.
    expect(src).not.toMatch(/name="default_(commission_pct|trial_days)"[^>]*disabled/);
  });

  it('the migration seeds the rate live is actually on and locks writes to platform admins', () => {
    const sql = read('supabase/migrations/20260817140000_platform_settings.sql');
    expect(sql).toContain('values (true, 5.00, 14)');
    expect(sql).toContain('enable row level security');
    expect(sql).toMatch(/platform_settings_write_platform[\s\S]*is_platform_admin\(\)/);
    // Singleton: the primary key is a boolean pinned true.
    expect(sql).toContain('platform_settings_singleton');
  });
});

describe('platform console pages', () => {
  it('the AI page hands the browser a boolean, never the stored key', () => {
    const src = read('app/(superadmin)/superadmin/ai/page.tsx');
    expect(src).toContain('hasKey: Boolean(p.api_key_encrypted)');
    const client = read('app/(superadmin)/superadmin/ai/ai-client.tsx');
    expect(client).not.toContain('api_key_encrypted');
  });

  it('both new pages are platform-gated', () => {
    for (const file of [
      'app/(superadmin)/superadmin/ai/page.tsx',
      'app/(superadmin)/superadmin/whatsapp/page.tsx',
    ]) {
      expect(read(file), `${file} must call requirePlatformAdmin`).toContain('await requirePlatformAdmin()');
    }
  });

  it('the WhatsApp page shows gyms with no settings row on their real defaults', () => {
    // A gym that never opened its WhatsApp tab has no row and is still fully
    // served (channel on, assistant off). Rendering blanks would say the
    // opposite of what its members experience.
    const src = read('app/(superadmin)/superadmin/whatsapp/page.tsx');
    expect(src).toContain('enabled: s?.enabled ?? true');
    expect(src).toContain('aiEnabled: s?.ai_enabled ?? false');
  });

  it('the channel toggle upserts, so a gym with no row can still be changed', () => {
    const src = read('lib/actions/platform-whatsapp.ts');
    expect(src).toContain('.upsert(');
    expect(src).toContain("onConflict: 'gym_id'");
    // Only the three switches this page owns; anything else stays the gym's.
    expect(src).toMatch(/const FLAGS = \{[\s\S]*qr_checkin_enabled[\s\S]*\} as const/);
  });

  it('both pages are reachable from the console nav', () => {
    const shell = read('components/superadmin/super-shell.tsx');
    expect(shell).toContain("sub: '/ai'");
    expect(shell).toContain("sub: '/whatsapp'");
  });
});
