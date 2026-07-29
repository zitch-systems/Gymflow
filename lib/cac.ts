// CAC (Corporate Affairs Commission) registration numbers — Nigeria.
//
// Pure: the parsing rules are the thing worth testing, and a gym owner typing
// their registration number should not have to guess our formatting.
//
// Three registration classes, each with its own prefix:
//   RC — a limited company        (RC 1234567)
//   BN — a registered business name (BN 1234567)
//   IT — incorporated trustees      (IT 123456)
// Owners write them every way imaginable: "rc-1234567", "RC/1234567",
// "1234567" with the prefix left off entirely. Normalise rather than reject.

export type CacClass = 'RC' | 'BN' | 'IT';

const CLASSES: CacClass[] = ['RC', 'BN', 'IT'];

/** Digits alone, no prefix — the shortest and longest CAC has issued. */
const MIN_DIGITS = 4;
const MAX_DIGITS = 8;

export type CacParse =
  | { ok: true; value: string; class: CacClass | null }
  | { ok: false; error: string };

/**
 * Normalise a typed registration number to storage form.
 *
 * Storage form is prefix + digits with no separator (RC1234567), or bare digits
 * when the owner didn't say which class — we don't invent one, because "RC" on
 * a business name registration would be wrong on a document a bank may check.
 * Leading zeros are preserved: they are part of the number, not padding.
 */
export function parseCacNumber(raw: string | null | undefined): CacParse {
  const cleaned = (raw ?? '').toUpperCase().replace(/[\s/\\.,_-]/g, '');
  if (!cleaned) return { ok: false, error: 'Enter your CAC registration number.' };

  const prefix = CLASSES.find((c) => cleaned.startsWith(c)) ?? null;
  const digits = prefix ? cleaned.slice(prefix.length) : cleaned;

  if (!/^\d+$/.test(digits)) {
    return { ok: false, error: 'A CAC number is RC, BN or IT followed by digits — for example RC1234567.' };
  }
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) {
    return { ok: false, error: `A CAC number has between ${MIN_DIGITS} and ${MAX_DIGITS} digits.` };
  }

  return { ok: true, value: `${prefix ?? ''}${digits}`, class: prefix };
}

/** Display form: a thin space after the prefix, so RC1234567 reads as RC 1234567. */
export function formatCacNumber(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = parseCacNumber(value);
  if (!parsed.ok) return value;
  return parsed.class ? `${parsed.class} ${parsed.value.slice(2)}` : parsed.value;
}

/** What the certificate upload accepts. Mirrors the gym-docs bucket's
 *  allowed_mime_types — the bucket is the enforcement, this is the message. */
export const CAC_DOC_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
export const CAC_DOC_MAX_BYTES = 5 * 1024 * 1024;

export function cacDocError(file: { type: string; size: number; name: string }): string | null {
  if (!(CAC_DOC_TYPES as readonly string[]).includes(file.type)) {
    return 'Upload the certificate as a PDF, PNG, JPEG or WebP.';
  }
  if (file.size > CAC_DOC_MAX_BYTES) return 'That file is larger than 5 MB.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}
