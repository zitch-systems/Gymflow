// Types for scripts/migrate-plan.mjs. Hand-written because the repo builds with
// allowJs:false — this lets test/migrations.test.ts import the runner's pure
// planning logic with real type-checking instead of an @ts-expect-error.

export type MigrationFile = { filename: string; checksum: string };
export type ChangedMigration = MigrationFile & { recorded: string };

export type MigrationPlan = {
  pending: MigrationFile[];
  changed: ChangedMigration[];
  alreadyApplied: MigrationFile[];
};

export function checksum(sql: string): string;
export function parseMigrationFilename(filename: string): { version: string; name: string } | null;
export function orderMigrations(filenames: readonly string[]): string[];
export function planMigrations(
  files: readonly MigrationFile[],
  applied: Record<string, string>,
): MigrationPlan;
export function orphanedLedgerEntries(
  files: readonly MigrationFile[],
  applied: Record<string, string>,
): string[];
