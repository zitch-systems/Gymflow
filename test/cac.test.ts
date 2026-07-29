import { describe, expect, it } from 'vitest';
import { asSuperuser } from './db';
import { CAC_DOC_MAX_BYTES, cacDocError, formatCacNumber, parseCacNumber } from '@/lib/cac';

// CAC registration numbers arrive typed by hand from a paper certificate, so
// the parser's job is to accept what a person would call correct and normalise
// it — while still refusing something that isn't a registration number at all.

describe('parseCacNumber', () => {
  it('accepts each registration class', () => {
    expect(parseCacNumber('RC1234567')).toEqual({ ok: true, value: 'RC1234567', class: 'RC' });
    expect(parseCacNumber('BN2345678')).toEqual({ ok: true, value: 'BN2345678', class: 'BN' });
    expect(parseCacNumber('IT123456')).toEqual({ ok: true, value: 'IT123456', class: 'IT' });
  });

  it('normalises the ways people actually write it', () => {
    for (const input of ['rc 1234567', 'RC-1234567', 'RC/1234567', ' rc1234567 ', 'R C 1 2 3 4 5 6 7'.replace(/ /g, '')]) {
      expect(parseCacNumber(input)).toMatchObject({ ok: true, value: 'RC1234567' });
    }
  });

  it('keeps a bare number bare rather than inventing a class', () => {
    // "RC" on a business-name registration would be wrong on a document a bank
    // may check, so an unprefixed number stays unprefixed.
    expect(parseCacNumber('1234567')).toEqual({ ok: true, value: '1234567', class: null });
  });

  it('preserves leading zeros', () => {
    expect(parseCacNumber('RC0001234')).toMatchObject({ value: 'RC0001234' });
  });

  it('rejects what is not a registration number', () => {
    expect(parseCacNumber('').ok).toBe(false);
    expect(parseCacNumber(null).ok).toBe(false);
    expect(parseCacNumber('not a number').ok).toBe(false);
    expect(parseCacNumber('RC').ok).toBe(false);
    expect(parseCacNumber('RC12').ok).toBe(false);          // too short
    expect(parseCacNumber('RC123456789').ok).toBe(false);   // too long
    expect(parseCacNumber('XY1234567').ok).toBe(false);     // not a CAC class
  });

  it('explains the shape rather than just failing', () => {
    const res = parseCacNumber('abcdef');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/RC/);
  });
});

describe('formatCacNumber', () => {
  it('spaces the prefix for display and round-trips through the parser', () => {
    expect(formatCacNumber('RC1234567')).toBe('RC 1234567');
    expect(parseCacNumber(formatCacNumber('RC1234567'))).toMatchObject({ value: 'RC1234567' });
  });

  it('leaves an unparseable stored value visible instead of blanking it', () => {
    // Better to show a human something odd they can fix than silently empty it.
    expect(formatCacNumber('legacy-value')).toBe('legacy-value');
    expect(formatCacNumber(null)).toBe('');
  });
});

describe('cacDocError', () => {
  const pdf = { type: 'application/pdf', size: 1000, name: 'cert.pdf' };

  it('accepts a certificate scan or PDF', () => {
    expect(cacDocError(pdf)).toBeNull();
    expect(cacDocError({ ...pdf, type: 'image/jpeg' })).toBeNull();
  });

  it('rejects what the bucket would reject anyway', () => {
    // The bucket's allowed_mime_types is the enforcement; this is the message.
    expect(cacDocError({ ...pdf, type: 'application/zip' })).toMatch(/PDF/);
    expect(cacDocError({ ...pdf, size: CAC_DOC_MAX_BYTES + 1 })).toMatch(/5 MB/);
    expect(cacDocError({ ...pdf, size: 0 })).toMatch(/empty/);
  });
});

describe('schema (20260729_gym_cac_registration)', () => {
  it('stores the number and the certificate path on the gym', async () => {
    const cols = await asSuperuser(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema='public' and table_name='gyms'
           and column_name in ('cac_number','cac_certificate_path') order by 1`,
      );
      return rows.map((r) => r.column_name);
    });
    expect(cols).toEqual(['cac_certificate_path', 'cac_number']);
  });

  it('keeps the document bucket private and PDF-capable', async () => {
    // A public bucket would serve the certificate off the CDN with no RLS at
    // all — the whole reason this isn't in gym-assets.
    const bucket = await asSuperuser(async (c) => {
      const { rows } = await c.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
        `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'gym-docs'`,
      );
      return rows[0];
    });
    expect(bucket).toBeTruthy();
    expect(bucket.public).toBe(false);
    expect(bucket.allowed_mime_types).toContain('application/pdf');
    expect(Number(bucket.file_size_limit)).toBe(CAC_DOC_MAX_BYTES);
  });

  it('gates the bucket with read/write/update/delete policies', async () => {
    const policies = await asSuperuser(async (c) => {
      const { rows } = await c.query<{ policyname: string; cmd: string }>(
        `select policyname, cmd from pg_policies
         where schemaname='storage' and tablename='objects' and policyname like 'gym_docs%'
         order by policyname`,
      );
      return rows;
    });
    expect(policies.map((p) => p.policyname)).toEqual([
      'gym_docs_delete', 'gym_docs_read', 'gym_docs_update', 'gym_docs_write',
    ]);
  });
});
