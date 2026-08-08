import { describe, expect, it } from 'vitest';
import {
  backupDue, backupFilename, backupStoragePath, humanSize, EXCLUDED_TABLES, KEEP_BACKUPS,
} from '@/lib/backup-plan';

// The scheduling rule and the naming, which are the parts of the backup feature
// that can be wrong quietly. A misjudged "due" check doesn't error — it just
// stops backing a gym up, and nobody finds out until they need the file.

const NOW = new Date('2026-08-08T02:20:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe('backupDue', () => {
  it('is false when backups are switched off', () => {
    expect(backupDue('off', null, NOW)).toBe(false);
    expect(backupDue('off', hoursAgo(999), NOW)).toBe(false);
  });

  it('is false for a missing or unrecognised frequency', () => {
    expect(backupDue(null, null, NOW)).toBe(false);
    expect(backupDue(undefined, null, NOW)).toBe(false);
    expect(backupDue('', null, NOW)).toBe(false);
    // A value the check constraint would reject must not be treated as daily.
    expect(backupDue('hourly', null, NOW)).toBe(false);
  });

  it('is true for a gym that has never run one', () => {
    // The first backup is the one most worth having, so it does not wait a
    // full period before the first run.
    expect(backupDue('daily', null, NOW)).toBe(true);
    expect(backupDue('weekly', null, NOW)).toBe(true);
    expect(backupDue('monthly', null, NOW)).toBe(true);
  });

  it('treats an unparseable last-run timestamp as never run', () => {
    expect(backupDue('daily', 'not-a-date', NOW)).toBe(true);
  });

  describe('daily', () => {
    it('is not due a few hours after the last run', () => {
      expect(backupDue('daily', hoursAgo(2), NOW)).toBe(false);
    });
    it('is due a day later', () => {
      expect(backupDue('daily', hoursAgo(24), NOW)).toBe(true);
    });
    it('tolerates a cron that drifts slightly earlier', () => {
      // 02:20:00 one day, 02:19:58 the next must not skip a day on two seconds.
      // The 12-hour grace is what makes that safe.
      expect(backupDue('daily', hoursAgo(23), NOW)).toBe(true);
    });
    it('does not fire twice within the same period', () => {
      expect(backupDue('daily', hoursAgo(11), NOW)).toBe(false);
    });
  });

  describe('weekly', () => {
    it('is not due mid-week', () => {
      expect(backupDue('weekly', hoursAgo(72), NOW)).toBe(false);
    });
    it('is due a week later', () => {
      expect(backupDue('weekly', hoursAgo(24 * 7), NOW)).toBe(true);
    });
  });

  describe('monthly', () => {
    it('is not due after a fortnight', () => {
      expect(backupDue('monthly', hoursAgo(24 * 14), NOW)).toBe(false);
    });
    it('is due after thirty days', () => {
      expect(backupDue('monthly', hoursAgo(24 * 30), NOW)).toBe(true);
    });
  });

  it('catches up rather than skipping when a run was missed', () => {
    // A cron that didn't fire for three days leaves a daily gym overdue, and it
    // must run at the next opportunity — measuring against the last COMPLETED
    // run rather than the calendar is what makes that work.
    expect(backupDue('daily', hoursAgo(72), NOW)).toBe(true);
    expect(backupDue('weekly', hoursAgo(24 * 30), NOW)).toBe(true);
  });

  it('accepts a Date as well as an ISO string', () => {
    expect(backupDue('daily', new Date(NOW.getTime() - 25 * 3_600_000), NOW)).toBe(true);
    expect(backupDue('daily', new Date(NOW.getTime() - 2 * 3_600_000), NOW)).toBe(false);
  });
});

describe('backupFilename', () => {
  it('slugs the gym name and stamps the date', () => {
    expect(backupFilename('Trivion Gym', NOW)).toBe('backup-trivion-gym-2026-08-08.zip');
  });

  it('strips characters that would break a Content-Disposition header', () => {
    // The name is staff-supplied and lands in a header and an email filename.
    expect(backupFilename('Iron "Republic"; rm -rf /', NOW)).toBe('backup-iron-republic-rm-rf-2026-08-08.zip');
    expect(backupFilename('Gym\nName', NOW)).toBe('backup-gym-name-2026-08-08.zip');
  });

  it('falls back to a usable name when the gym has none', () => {
    expect(backupFilename(null, NOW)).toBe('backup-gym-2026-08-08.zip');
    expect(backupFilename('', NOW)).toBe('backup-gym-2026-08-08.zip');
    expect(backupFilename('!!!', NOW)).toBe('backup-gym-2026-08-08.zip');
  });
});

describe('backupStoragePath', () => {
  const GYM = '11111111-2222-3333-4444-555555555555';

  it('puts the gym id first, which is what the bucket policy scopes on', () => {
    // storage.objects RLS does split_part(name, '/', 1) = gym_id. Anything else
    // in that first segment silently makes the object unreadable to its owner.
    expect(backupStoragePath(GYM, 'backup-x-2026-08-08.zip', NOW).split('/')[0]).toBe(GYM);
  });

  it('is unique per run so two backups on one day cannot collide', () => {
    // upload() uses upsert:false — a colliding key would fail the second run of
    // the day, which is exactly what "Back up now" does after a scheduled one.
    const a = backupStoragePath(GYM, 'b.zip', new Date('2026-08-08T02:20:00Z'));
    const b = backupStoragePath(GYM, 'b.zip', new Date('2026-08-08T09:41:00Z'));
    expect(a).not.toBe(b);
  });
});

describe('humanSize', () => {
  it('reads as a size a person would say out loud', () => {
    expect(humanSize(0)).toBe('0 B');
    expect(humanSize(512)).toBe('512 B');
    expect(humanSize(2048)).toBe('2 KB');
    expect(humanSize(1024 * 1024 * 1.25)).toBe('1.3 MB');
  });
});

describe('the excluded-table list', () => {
  it('holds back everything that carries payment or bank credentials', () => {
    // This is the assertion that matters most in this file: the archive is
    // emailed, and these tables must never be in it. A future contributor
    // adding a table to the backup set will trip this if they add one of these.
    for (const t of ['saved_cards', 'gym_payout_accounts', 'instructor_bank_details', 'payout_change_requests']) {
      expect(EXCLUDED_TABLES).toHaveProperty(t);
    }
  });

  it('documents a reason for every exclusion', () => {
    for (const [table, reason] of Object.entries(EXCLUDED_TABLES)) {
      expect(reason, `${table} needs a reason`).toBeTruthy();
    }
  });
});

describe('retention', () => {
  it('keeps a useful history without hoarding member extracts', () => {
    expect(KEEP_BACKUPS).toBeGreaterThanOrEqual(3);
    expect(KEEP_BACKUPS).toBeLessThanOrEqual(20);
  });
});
