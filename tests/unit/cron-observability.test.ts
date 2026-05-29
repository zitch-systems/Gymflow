import { describe, it, expect, vi, beforeEach } from 'vitest';

const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureMessage }));

import { reportCronCap } from '@/lib/cron-observability';

const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

beforeEach(() => {
  captureMessage.mockClear();
  warnSpy.mockClear();
});

describe('reportCronCap', () => {
  it('no-ops when skipped is 0 (a healthy cron stays quiet)', () => {
    reportCronCap({ cron: 'auto-debit', processed: 50, skipped: 0 });
    expect(captureMessage).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('no-ops on a negative skipped value (defensive guard)', () => {
    reportCronCap({ cron: 'auto-debit', processed: 50, skipped: -1 });
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('warns to console AND to Sentry when the cap was hit', () => {
    reportCronCap({
      cron: 'auto-debit',
      processed: 400,
      skipped: 87,
      extra: { charged: 350, failed: 50 },
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [msg, opts] = captureMessage.mock.calls[0] as [string, { level: string; tags: Record<string, string>; extra: Record<string, unknown> }];
    expect(msg).toMatch(/auto-debit.*cap.*processed 400.*deferred 87/);
    expect(opts.level).toBe('warning');
    expect(opts.tags).toEqual({ cron: 'auto-debit', cap_hit: 'true' });
    expect(opts.extra).toMatchObject({ processed: 400, skipped: 87, charged: 350, failed: 50 });
  });

  it('the cron name lands in the message AND the tag so Sentry can group by it', () => {
    reportCronCap({ cron: 'platform-renewals', processed: 200, skipped: 10 });
    const [msg, opts] = captureMessage.mock.calls[0] as [string, { tags: { cron: string } }];
    expect(msg).toContain('platform-renewals');
    expect(opts.tags.cron).toBe('platform-renewals');
  });
});
