import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checksum, orderMigrations, orphanedLedgerEntries, parseMigrationFilename, planMigrations,
} from '../scripts/migrate-plan.mjs';

// Planning logic for the migration runner. Getting this wrong has exactly two
// failure modes and both are bad: skip a migration (the live database silently
// lacks it — which is how a security fix sat unapplied in production), or
// replay one against live data.

const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'migrations');
const file = (filename: string, sum = 'aa') => ({ filename, checksum: sum });

describe('parseMigrationFilename', () => {
  it('splits a migration into its ordering prefix and name', () => {
    expect(parseMigrationFilename('20260713_gym_integrations.sql'))
      .toEqual({ version: '20260713', name: 'gym_integrations' });
    expect(parseMigrationFilename('00000000000000_baseline_schema.sql'))
      .toEqual({ version: '00000000000000', name: 'baseline_schema' });
  });

  it('rejects anything that is not a migration', () => {
    for (const f of ['README.md', 'notes.sql', '_leading.sql', '20260713.sql']) {
      expect(parseMigrationFilename(f)).toBeNull();
    }
  });
});

describe('orderMigrations', () => {
  it('orders lexicographically — the same order the shadow DB and tests use', () => {
    expect(orderMigrations([
      '20260713_b.sql', '00000000000000_baseline_schema.sql', '20260609_a.sql',
    ])).toEqual([
      '00000000000000_baseline_schema.sql', '20260609_a.sql', '20260713_b.sql',
    ]);
  });

  it('keeps colliding prefixes in a stable, name-based order', () => {
    // 20260713_* is seven real files in this repo; they must all survive and
    // keep a deterministic relative order.
    expect(orderMigrations(['20260713_gym_integrations.sql', '20260713_gym_amenities.sql']))
      .toEqual(['20260713_gym_amenities.sql', '20260713_gym_integrations.sql']);
  });

  it('drops non-migration files and does not mutate the input', () => {
    const input = ['README.md', '20260609_a.sql'];
    expect(orderMigrations(input)).toEqual(['20260609_a.sql']);
    expect(input).toEqual(['README.md', '20260609_a.sql']);
  });
});

describe('planMigrations', () => {
  it('treats everything as pending against an empty ledger', () => {
    const plan = planMigrations([file('20260609_a.sql'), file('20260610_b.sql')], {});
    expect(plan.pending.map((p) => p.filename)).toEqual(['20260609_a.sql', '20260610_b.sql']);
    expect(plan.alreadyApplied).toEqual([]);
    expect(plan.changed).toEqual([]);
  });

  it('returns pending in apply order regardless of directory order', () => {
    const plan = planMigrations([file('20260713_z.sql'), file('20260609_a.sql')], {});
    expect(plan.pending.map((p) => p.filename)).toEqual(['20260609_a.sql', '20260713_z.sql']);
  });

  it('skips migrations whose checksum matches the ledger', () => {
    const plan = planMigrations([file('20260609_a.sql', 'x')], { '20260609_a.sql': 'x' });
    expect(plan.pending).toEqual([]);
    expect(plan.alreadyApplied.map((p) => p.filename)).toEqual(['20260609_a.sql']);
  });

  it('flags an already-applied migration that was edited, instead of re-running it', () => {
    const plan = planMigrations([file('20260609_a.sql', 'NEW')], { '20260609_a.sql': 'OLD' });
    expect(plan.pending).toEqual([]);
    expect(plan.changed).toEqual([{ filename: '20260609_a.sql', checksum: 'NEW', recorded: 'OLD' }]);
  });

  it('does NOT confuse two migrations that share a version prefix', () => {
    // The reason the ledger is keyed on filename: a version-keyed ledger would
    // record 20260713 once and silently skip its six siblings.
    const files = [
      file('20260713_gym_socials_gallery.sql', 'a'),
      file('20260713_gym_integrations.sql', 'b'),
    ];
    const plan = planMigrations(files, { '20260713_gym_socials_gallery.sql': 'a' });
    expect(plan.pending.map((p) => p.filename)).toEqual(['20260713_gym_integrations.sql']);
  });
});

describe('orphanedLedgerEntries', () => {
  it('reports ledger rows with no file in the repo', () => {
    expect(orphanedLedgerEntries([file('20260609_a.sql')], { '20260609_a.sql': 'aa', '19990101_gone.sql': 'bb' }))
      .toEqual(['19990101_gone.sql']);
  });

  it('is empty when the repo covers the ledger', () => {
    expect(orphanedLedgerEntries([file('20260609_a.sql')], { '20260609_a.sql': 'aa' })).toEqual([]);
  });
});

describe('checksum', () => {
  it('is stable for identical content and differs on any edit', () => {
    expect(checksum('select 1;')).toBe(checksum('select 1;'));
    expect(checksum('select 1;')).not.toBe(checksum('select 2;'));
    expect(checksum('select 1;')).toHaveLength(64);
  });
});

// Guards on the real migrations directory — these are what stop the runner from
// meeting a shape it cannot order or track.
describe('the repo migrations directory', () => {
  const filenames = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

  it('contains only parseable migration filenames', () => {
    const bad = filenames.filter((f) => parseMigrationFilename(f) === null);
    expect(bad).toEqual([]);
  });

  it('has a unique filename per migration, so the ledger key is total', () => {
    expect(new Set(filenames).size).toBe(filenames.length);
  });

  it('starts with the baseline — everything else sorts after it', () => {
    expect(orderMigrations(filenames)[0]).toBe('00000000000000_baseline_schema.sql');
  });

  it('plans every migration as pending against a fresh database', () => {
    const files = filenames.map((f) => ({
      filename: f,
      checksum: checksum(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')),
    }));
    const plan = planMigrations(files, {});
    // Nothing is dropped on the way in: a file that failed to parse would
    // silently vanish from the plan rather than fail loudly.
    expect(plan.pending).toHaveLength(filenames.length);
    expect(plan.changed).toEqual([]);
  });
});
